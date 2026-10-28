#!/usr/bin/env ruby
# Stapling changes the DMG bytes after electron-builder writes its manifest.
require 'yaml'
require 'digest'
require 'base64'

def check_manifest(directory, version, refresh_dmg: false)
  raise 'Invalid release version' unless version.match?(/\A\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\z/)
  path = File.join(directory, 'latest-mac.yml')
  manifest = YAML.safe_load(File.read(path))
  zip_name = "DoodleNote-#{version}-arm64-mac.zip"
  dmg_name = "DoodleNote-#{version}-arm64.dmg"
  raise 'Manifest version mismatch' unless manifest['version'] == version
  files = manifest.fetch('files')
  raise 'Unexpected manifest artifacts' unless files.map { |f| f.fetch('url') }.sort == [zip_name, dmg_name].sort
  raise 'Updater must use ZIP' unless manifest['path'] == zip_name
  files.each do |entry|
    artifact = File.join(directory, entry.fetch('url'))
    digest = Base64.strict_encode64(Digest::SHA512.file(artifact).digest)
    size = File.size(artifact)
    if entry['url'] == dmg_name && refresh_dmg
      entry['sha512'] = digest
      entry['size'] = size
      # The builder's pre-stapling blockmap is no longer valid.
      entry.delete('blockMapSize')
    else
      raise 'Artifact hash/size mismatch' unless entry['sha512'] == digest && entry['size'] == size
    end
    if entry['url'] == zip_name
      raise 'Top-level ZIP hash mismatch' unless manifest['sha512'] == digest
    end
  end
  File.write(path, YAML.dump(manifest)) if refresh_dmg
end

if $PROGRAM_NAME == __FILE__
  unless ARGV.length.between?(2, 3) && (ARGV[2].nil? || ARGV[2] == '--refresh-dmg')
    abort 'Usage: mac-release-manifest.rb RELEASE_DIR VERSION [--refresh-dmg]'
  end
  check_manifest(ARGV[0], ARGV[1], refresh_dmg: ARGV[2] == '--refresh-dmg')
  puts 'Manifest version, paths, sizes and SHA-512 hashes verified.'
end
