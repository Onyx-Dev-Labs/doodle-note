import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

for (const failArtifact of [false, true])
  test(
    failArtifact
      ? 'Windows beta does not publish manifests after an artifact exhausts retries'
      : 'Windows beta retries complete artifact bytes before publishing either manifest',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'doodlenote-publisher-test-'))
      const directory = path.dirname(fileURLToPath(import.meta.url))
      const { version } = JSON.parse(
        await readFile(path.join(directory, '../package.json'), 'utf8')
      )
      const installer = `DoodleNote-${version}-setup.exe`
      const destination = `updates/DoodleNote-${version}-beta-setup.exe`
      const data = Buffer.from('Synthetic installer fixture; not an executable.\n'.repeat(4096))
      const blockmap = Buffer.from('Synthetic blockmap fixture.\n')
      const sha512 = createHash('sha512').update(data).digest('base64')
      const manifest = `version: ${version}\nfiles:\n  - url: ${installer}\n    sha512: ${sha512}\n    size: ${data.length}\npath: ${installer}\nsha512: ${sha512}\nreleaseDate: '2026-10-06T00:00:00.000Z'\n`
      await Promise.all([
        writeFile(path.join(folder, installer), data),
        writeFile(path.join(folder, `${installer}.blockmap`), blockmap),
        writeFile(path.join(folder, 'latest.yml'), manifest)
      ])
      const requests = []
      const server = http.createServer(async (request, response) => {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const pathname = new URL(request.url, 'http://localhost').searchParams.get('pathname')
        requests.push({ pathname, body: Buffer.concat(chunks) })
        response.setHeader('Content-Type', 'application/json')
        if (failArtifact || requests.filter((row) => row.pathname === pathname).length === 1) {
          response.statusCode = 503
          response.end(JSON.stringify({ error: { code: 'service_unavailable' } }))
        } else {
          response.end(JSON.stringify({ pathname, url: `http://127.0.0.1/${pathname}` }))
        }
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      try {
        const result = await new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [path.join(directory, 'publish-windows-beta.mjs')],
            {
              env: {
                ...process.env,
                WINDOWS_RELEASE_DIR: folder,
                BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_synthetic_token',
                VERCEL_BLOB_API_URL: `http://127.0.0.1:${server.address().port}`,
                VERCEL_BLOB_RETRIES: '1'
              },
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe']
            }
          )
          let output = ''
          child.stdout.on('data', (chunk) => {
            output += chunk
          })
          child.stderr.on('data', (chunk) => {
            output += chunk
          })
          const timeout = setTimeout(() => {
            child.kill()
            reject(new Error('Publisher fixture timed out'))
          }, 30000)
          child.once('error', (error) => {
            clearTimeout(timeout)
            reject(error)
          })
          child.once('exit', (code) => {
            clearTimeout(timeout)
            resolve({ code, output })
          })
        })
        if (failArtifact) {
          assert.notEqual(result.code, 0)
          assert.deepEqual(
            requests.map((row) => row.pathname),
            [destination, destination]
          )
          assert.ok(requests.every((row) => row.body.equals(data)))
          return
        }
        assert.equal(result.code, 0, result.output)
        assert.deepEqual(
          requests.map((row) => row.pathname),
          [
            destination,
            destination,
            `${destination}.blockmap`,
            `${destination}.blockmap`,
            'updates/beta.yml',
            'updates/beta.yml',
            'updates/latest-beta.yml',
            'updates/latest-beta.yml'
          ]
        )
        assert.ok(requests.slice(0, 2).every((row) => row.body.equals(data)))
        assert.ok(requests.slice(2, 4).every((row) => row.body.equals(blockmap)))
        assert.ok(requests[4].body.equals(requests[5].body))
        assert.ok(requests[6].body.equals(requests[7].body))
        assert.match(
          requests[4].body.toString(),
          new RegExp(`DoodleNote-${version}-beta-setup\\.exe`)
        )
      } finally {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
        assert.equal(path.dirname(path.resolve(folder)), path.resolve(tmpdir()))
        assert.ok(path.basename(folder).startsWith('doodlenote-publisher-test-'))
        await rm(folder, { recursive: true, force: true })
      }
    }
  )
