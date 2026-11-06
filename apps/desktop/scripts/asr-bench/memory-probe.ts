/**
 * Memory probe: decodes many utterance-length inputs and samples RSS, to see
 * whether ONNX Runtime memory keeps growing with distinct input lengths.
 *   tsx scripts/asr-bench/memory-probe.ts <model-dir> <bucketSec|0> <count>
 */
import { loadSherpa, parakeetRecognizerConfig } from '../../src/main/windows-asr-recognizers'

const [dir, bucketArg, countArg, providerConfig] = process.argv.slice(2)
const bucket = Number(bucketArg ?? 0)
const count = Number(countArg ?? 200)
const sherpa = loadSherpa()
const config = parakeetRecognizerConfig(dir!, 2) as { modelConfig: { provider: string } }
// Optional sherpa provider config file, e.g. EnableCpuMemArena=0.
if (providerConfig) config.modelConfig.provider = `cpu:${providerConfig}`
const recognizer = new sherpa.OfflineRecognizer(config)
let seed = 12345
const random = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const samples: Array<{ i: number; rssMb: number }> = []
const began = performance.now()
for (let i = 0; i < count; i++) {
  let seconds = 0.5 + random() * 14.5
  if (bucket > 0) seconds = Math.ceil(seconds / bucket) * bucket
  const audio = new Float32Array(Math.round(seconds * 16000))
  for (let k = 0; k < audio.length; k++) audio[k] = (random() - 0.5) * 0.02
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples: audio, sampleRate: 16000 })
  recognizer.decode(stream)
  recognizer.getResult(stream)
  if (i % 20 === 19) samples.push({ i: i + 1, rssMb: Math.round(process.memoryUsage().rss / 1048576) })
}
console.log(JSON.stringify({ bucket, count, seconds: Math.round((performance.now() - began) / 1000), samples, peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024) }))
