/**
 * Branded landing pages served by the local OAuth redirect during sign-in.
 * Full documents with an explicit UTF-8 charset — without it, browsers guess
 * the encoding and the emoji renders as mojibake. DoodleNote comes back to
 * the front once sign-in succeeds, so the page only has to say so.
 */
export function calendarLandingPage(title: string, message: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>DoodleNote</title>' +
    // Drop the one-time sign-in code from the address bar and history.
    "<script>history.replaceState(null,'',location.pathname)</script></head>" +
    "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    'background:#f7f5ee;color:#26281f;display:flex;align-items:center;justify-content:center;' +
    'height:100vh;margin:0">' +
    '<div style="text-align:center;max-width:440px;padding:0 24px">' +
    '<div style="font-size:19px;font-weight:700;letter-spacing:-0.01em;margin-bottom:26px">' +
    '<span style="color:#26281f">Doodle</span><span style="color:#7c9769">Note</span></div>' +
    '<h2 style="margin:0 0 10px;font-family:ui-serif,Georgia,serif;font-size:26px">' +
    title +
    '</h2>' +
    '<p style="color:#8a8d7f;line-height:1.55;margin:0">' +
    message +
    '</p>' +
    '<div style="margin-top:30px;font-size:12px;color:#b4b6a8">Local &amp; private &middot; ' +
    'your calendar stays on your computer</div>' +
    '</div></body></html>'
  )
}

export const MICROSOFT_SUCCESS_PAGE = calendarLandingPage(
  'You&rsquo;re connected &#127881;',
  'DoodleNote is linked to your Microsoft&nbsp;365 calendar. Head back to the app &mdash; you can close this tab.'
)

export const MICROSOFT_ERROR_PAGE = calendarLandingPage(
  'Sign-in didn&rsquo;t finish',
  'Something interrupted the Microsoft sign-in. Head back to DoodleNote and try again from Settings &rarr; Calendar.'
)

export const GOOGLE_SUCCESS_PAGE = calendarLandingPage(
  'You&rsquo;re connected &#127881;',
  'DoodleNote is linked to your Google Calendar. Head back to the app &mdash; you can close this tab.'
)

export const GOOGLE_ERROR_PAGE = calendarLandingPage(
  'Sign-in didn&rsquo;t finish',
  'Something interrupted the Google sign-in. Head back to DoodleNote and try again from Settings &rarr; Calendar.'
)
