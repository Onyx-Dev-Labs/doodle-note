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
