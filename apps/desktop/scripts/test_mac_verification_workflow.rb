require 'minitest/autorun'
require 'yaml'

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
