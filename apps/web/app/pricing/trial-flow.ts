export const TRIAL_CHECKOUT_PATH = "/pricing?checkout=1";
export const TRIAL_LOGIN_PATH = `/login?next=${encodeURIComponent(TRIAL_CHECKOUT_PATH)}`;

export function shouldAutoStartTrialCheckout({
  requested,
  attempted,
  viewKind,
}: {
  requested: boolean;
  attempted: boolean;
  viewKind: string;
}): boolean {
  return requested && !attempted && viewKind === "start-trial";
}
