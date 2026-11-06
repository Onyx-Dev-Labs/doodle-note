require 'minitest/autorun'
require 'yaml'

class HostedMacGuiSessionWorkflowTest < Minitest::Test
  def setup
    @workflow = YAML.safe_load(File.read(File.expand_path('../../../.github/workflows/mac-release.yml', __dir__)))
    @jobs = @workflow.fetch('jobs')
    @job = @jobs.fetch('gui-session-preflight')
  end

  def test_dispatch_operation_is_isolated_from_build_and_artifact_verification
    trigger = @workflow['on'] || @workflow[true]
    operation = trigger.fetch('workflow_dispatch').fetch('inputs').fetch('operation')
    assert_equal %w[candidate verify-existing gui-session-preflight], operation.fetch('options')
    assert_equal 'candidate', operation.fetch('default')
    assert_equal "github.repository == 'Onyx-Dev-Labs/doodle-note' && (inputs.operation == 'candidate' || inputs.operation == '')", @jobs.fetch('release').fetch('if')
    assert_equal "github.repository == 'Onyx-Dev-Labs/doodle-note' && inputs.operation == 'verify-existing' && github.ref != 'refs/heads/main'", @jobs.fetch('verify-existing').fetch('if')
    assert_equal "github.repository == 'Onyx-Dev-Labs/doodle-note' && inputs.operation == 'gui-session-preflight' && startsWith(github.ref, 'refs/heads/') && github.ref != 'refs/heads/main'", @job.fetch('if')
  end

  def test_hosted_job_is_bounded_and_has_no_artifact_acquisition_or_secrets
    assert_equal 'macos-15', @job.fetch('runs-on')
    assert_equal 5, @job.fetch('timeout-minutes')
    assert_equal({ 'contents' => 'read' }, @job.fetch('permissions'))
    refute_match(/secrets\.|github.token|GITHUB_TOKEN|download-artifact|candidate_artifact_id|publish-release|electron-builder|swift build|pnpm install|npm install|sudo|osascript/, @job.to_s)
    steps = @job.fetch('steps')
    checkout = steps.find { |s| s['uses']&.start_with?('actions/checkout@') }
    assert_equal false, checkout.fetch('with').fetch('persist-credentials')
    probe = steps.find { |s| s.fetch('run', '').include?('preflight.py --output') }
    assert_equal 2, probe.fetch('timeout-minutes')
    assert_equal({ 'HARNESS_SHA' => '${{ github.sha }}' }, probe.fetch('env'))
    steps.each { |s| refute_match(/\$\{\{/, s.fetch('run', '')) }
  end

  def test_only_session_report_is_retained_on_blocked_exit
    upload = @job.fetch('steps').find { |s| s['uses']&.start_with?('actions/upload-artifact@') }
    assert_equal 'always()', upload.fetch('if')
    assert_equal '${{ runner.temp }}/hosted-mac-gui-session/result.json', upload.fetch('with').fetch('path')
    assert_equal 14, upload.fetch('with').fetch('retention-days')
    assert_equal 'warn', upload.fetch('with').fetch('if-no-files-found')
  end
end
