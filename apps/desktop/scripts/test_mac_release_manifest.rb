require 'minitest/autorun'
require 'tmpdir'
require_relative 'mac-release-manifest'

class MacReleaseManifestTest < Minitest::Test
  def setup
    @directory = Dir.mktmpdir
    @version = '0.0.1'
    @zip = "DoodleNote-#{@version}-arm64-mac.zip"
    @dmg = "DoodleNote-#{@version}-arm64.dmg"
    files = [@zip, @dmg].map do |name|
      File.write(File.join(@directory, name), name)
      { 'url' => name, 'sha512' => Base64.strict_encode64(Digest::SHA512.digest(name)), 'size' => name.bytesize }
    end
    @manifest = { 'version' => @version, 'files' => files, 'path' => @zip, 'sha512' => files.first['sha512'] }
    write_manifest
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def write_manifest
    File.write(File.join(@directory, 'latest-mac.yml'), YAML.dump(@manifest))
  end

  def test_stapling_requires_refresh_then_verifies
    check_manifest(@directory, @version)
    File.write(File.join(@directory, @dmg), 'synthetic stapled payload')
    assert_raises(RuntimeError) { check_manifest(@directory, @version) }
    check_manifest(@directory, @version, refresh_dmg: true)
    check_manifest(@directory, @version)
  end

  def test_refresh_does_not_hide_corrupt_zip
    File.write(File.join(@directory, @zip), 'corrupt')
    assert_raises(RuntimeError) { check_manifest(@directory, @version, refresh_dmg: true) }
  end

  def test_unexpected_path_and_version_fail
    @manifest['files'][0]['url'] = '../outside.zip'
    write_manifest
    assert_raises(RuntimeError) { check_manifest(@directory, @version, refresh_dmg: true) }
    assert_raises(RuntimeError) { check_manifest(@directory, '0.0.2') }
  end

  def test_legacy_hash_must_match_zip
    @manifest['sha512'] = 'wrong'
    write_manifest
    assert_raises(RuntimeError) { check_manifest(@directory, @version, refresh_dmg: true) }
  end
end
