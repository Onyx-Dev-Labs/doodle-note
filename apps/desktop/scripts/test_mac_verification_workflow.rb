require 'minitest/autorun'
require 'yaml'
require 'open3'
require 'tmpdir'

class MacVerificationWorkflowTest < Minitest::Test
  def setup
    @workflow = YAML.safe_load(File.read(File.expand_path('../../../.github/workflows/mac-release.yml', __dir__)))
    @jobs = @workflow.fetch('jobs')
    @verification = @jobs.fetch('verify-existing')
  end

  def test_verification_cannot_build_sign_or_publish
    assert_equal 'macos-14', @verification.fetch('runs-on')
    assert_equal 20, @verification.fetch('timeout-minutes')
    assert_equal({ 'contents' => 'read', 'actions' => 'read' }, @verification.fetch('permissions'))
    assert_includes @verification.fetch('if'), "inputs.operation == 'verify-existing'"
    assert_includes @verification.fetch('if'), "github.ref != 'refs/heads/main'"
    serialized = @verification.to_s
    refute_match(/secrets\.|publish-release|electron-builder|swift build|pnpm install|npm install/, serialized)
    checkout = @verification.fetch('steps').find { |s| s['uses']&.start_with?('actions/checkout@') }
    assert_equal false, checkout.fetch('with').fetch('persist-credentials')
    @verification.fetch('steps').each do |step|
      refute_match(/\$\{\{/, step.fetch('run', '')) # Inputs enter only through env.
    end
  end

  def test_candidate_default_remains_artifact_only_and_separate
    triggers = @workflow['on'] || @workflow[true] # YAML 1.1 treats on as a boolean.
    assert_equal 'candidate', triggers.fetch('workflow_dispatch').fetch('inputs').fetch('operation').fetch('default')
    release = @jobs.fetch('release')
    assert_includes release.fetch('if'), "inputs.operation == 'candidate' || inputs.operation == ''"
    assert_equal 'macos-15', release.fetch('runs-on')
    assert_includes release.to_s, '--publish never'
    refute_match(/BLOB_READ_WRITE_TOKEN|publish-release\.mjs/, release.to_s)
    assert_includes @workflow.fetch('concurrency').fetch('group'), 'inputs.operation'
    assert_includes @workflow.fetch('concurrency').fetch('group'), 'inputs.candidate_artifact_id'
    assert_equal false, @workflow.fetch('concurrency').fetch('cancel-in-progress')
  end

  def test_failure_evidence_is_retained_with_bounded_artifact_scope
    upload = @verification.fetch('steps').find { |s| s['uses']&.start_with?('actions/upload-artifact@') }
    assert_equal 'always()', upload.fetch('if')
    paths = upload.fetch('with').fetch('path').lines.map(&:strip)
    assert_equal ['${{ runner.temp }}/mac-candidate-verification/result.json',
                  '${{ runner.temp }}/mac-candidate-verification/commands.log'], paths
    assert_equal 14, upload.fetch('with').fetch('retention-days')
  end
end

class CandidateStaplerWorkflowTest < Minitest::Test
  def setup
    @workflow = YAML.safe_load(File.read(File.expand_path('../../../.github/workflows/mac-release.yml', __dir__)))
    @release = @workflow.fetch('jobs').fetch('release')
    @steps = @release.fetch('steps')
  end

  def test_diagnostics_uses_runner_environment_only_after_checkout
    # https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability
    @workflow.fetch('jobs').each_value do |job|
      refute_match(/\brunner\s*(?:\.|\[)/, job.fetch('env', {}).to_s)
    end
    refute @release.fetch('env').key?('DOODLENOTE_STAPLER_DIAGNOSTICS')
    assert_equal '${{ github.workspace }}/apps/desktop/scripts/stapler.cjs',
                 @release.fetch('env').fetch('DOODLENOTE_STAPLER_HELPER')
    init = @steps.find { |s| s['id'] == 'tooling' }
    assert_equal @steps.index(@steps.find { |s| s['id'] == 'checkout' }) + 1, @steps.index(init)
    assert_includes init.fetch('run'), 'DOODLENOTE_STAPLER_DIAGNOSTICS='
    assert_equal 1, @steps.sum { |s| s.fetch('run', '').scan('DOODLENOTE_STAPLER_DIAGNOSTICS=').length }
    %w[dependencies package dmg verify candidate diagnostics].each do |id|
      assert_operator @steps.index(init), :<, @steps.index(@steps.find { |s| s['id'] == id })
    end
    collect = @steps.find { |s| s['id'] == 'diagnostics' }
    assert_includes collect.fetch('env').to_s, 'steps.tooling.outcome'
  end

  def test_diagnostics_initialization_writes_fixed_path_and_fails_closed
    run = @steps.find { |s| s['id'] == 'tooling' }.fetch('run')
    # Execute the real initialization prefix without running unrelated tooling tests.
    initialization, tooling = run.split('python3 -m unittest', 2)
    refute_nil tooling
    assert_includes initialization, 'GITHUB_ENV'
    Dir.mktmpdir('diagnostic init ') do |dir|
      env_file = File.join(dir, 'github env')
      env = { 'RUNNER_TEMP' => dir, 'GITHUB_ENV' => env_file }
      out, err, status = Open3.capture3(env, 'bash', '-c', initialization)
      assert status.success?, err
      assert_empty out
      assert_empty err
      assert_equal "DOODLENOTE_STAPLER_DIAGNOSTICS=#{dir}/mac-release-diagnostics\n", File.read(env_file)
      [{ 'RUNNER_TEMP' => nil }, { 'RUNNER_TEMP' => '' },
       { 'GITHUB_ENV' => nil }, { 'GITHUB_ENV' => '' }, { 'GITHUB_ENV' => dir }].each do |invalid|
        out, _err, status = Open3.capture3(env.merge(invalid), 'bash', '-c', initialization + "printf reached-tooling")
        refute status.success?, invalid.inspect
        assert_empty out # Initialization failure must stop later commands.
      end
    end
  end

  def test_candidate_evidence_is_always_bounded_and_success_artifacts_still_gated
    collect = @steps.find { |s| s['id'] == 'diagnostics' }
    refute_nil collect
    assert_equal 'always()', collect.fetch('if')
    upload = @steps.find { |s| s['name'] == 'Retain candidate diagnostics' }
    assert_equal 'always()', upload.fetch('if')
    assert_equal 3, upload.fetch('with').fetch('retention-days')
    paths = upload.fetch('with').fetch('path').lines.map(&:strip)
    assert_equal ['${{ runner.temp }}/mac-release-diagnostics/summary.json',
                  '${{ runner.temp }}/mac-release-diagnostics/notary-dmg.json',
                  '${{ runner.temp }}/mac-release-diagnostics/staple-*.json',
                  '${{ runner.temp }}/mac-release-diagnostics/validate-*.json'], paths
    candidate = @steps.find { |s| s.dig('with', 'name') == 'doodlenote-mac-${{ github.sha }}' }
    assert_equal 'success()', candidate.fetch('if')
    assert_operator @steps.index(candidate), :>, @steps.index(@steps.find { |s| s['id'] == 'verify' })
    refute_match(/continue-on-error/, @release.to_s)
    %w[tooling credentials node pnpm dependencies swift whisper brand package dmg verify candidate].each do |id|
      assert @steps.any? { |s| s['id'] == id }, id
      assert_includes collect.fetch('env').to_s, "steps.#{id}.outcome"
    end
  end

  def test_all_stapler_sites_use_one_helper_after_submission_and_before_receipt
    assert_includes @release.fetch('env').fetch('DOODLENOTE_STAPLER_HELPER'), '/apps/desktop/scripts/stapler.cjs'
    dmg = @steps.find { |s| s['id'] == 'dmg' }.fetch('run')
    assert_includes dmg, 'set -euo pipefail'
    assert_operator dmg.index('notarytool submit'), :<, dmg.index('stapler.cjs')
    assert_includes dmg, 'mac-release-diagnostics.cjs accepted'
    refute_match(/xcrun stapler/, @release.to_s)
    verifier = File.read(File.join(__dir__, 'verify-mac-release.sh'))
    refute_match(/xcrun stapler/, verifier)
    assert_includes verifier, 'stapler.cjs" validate "$2" "$bundle"'
    assert_includes verifier, 'stapler.cjs" validate dmg "$dmg"'
    %w[build-app zip-app dmg-app].each { |role| assert_includes verifier, role }
    assert_operator verifier.index('mac-release-manifest.rb'), :<, verifier.index('> "$release_dir/release-receipt.txt"')
    assert_equal 2, verifier.scan('diff -qr').length
    assert_includes verifier, 'codesign --verify --deep --strict'
    assert_includes verifier, 'spctl --assess --type execute'
    assert_includes verifier, 'TeamIdentifier=$expected_team'
  end
end
