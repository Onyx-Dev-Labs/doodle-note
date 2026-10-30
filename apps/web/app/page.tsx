/* eslint-disable @next/next/no-img-element -- Local, fixed-size illustrative mascot assets. */
import { MarketingLayout, MarketingDownloadButtons } from "./marketing";
import "./marketing.css";

export default function HomePage() {
  return (
    <MarketingLayout>
      <main id="main">
        <section className="hero wrap">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="mini-star" aria-hidden="true">
                ✳
              </span>{" "}
              A little headspace for your best ideas
            </div>
            <h1>
              Be in the moment.
              <br />
              Keep the{" "}
              <span className="underlined">
                good stuff.
                <svg
                  viewBox="0 0 400 24"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M5 13C91 0 227 2 392 11M13 20C137 10 251 10 368 17"></path>
                </svg>
              </span>
            </h1>
            <p className="hero-description">
              The conversation, the lightbulb moment, the thing you promised to
              do. Give it all a home that feels a little more you.
            </p>
            <MarketingDownloadButtons />
            <div className="hero-secondary-links">
              <a className="text-link" href="#how-it-works">
                <span className="play" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M9 6L18 12L9 18Z"></path>
                  </svg>
                </span>
                See how it feels
              </a>
            </div>
            <p className="hero-footnote">
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="M9 1.5l6 2.4v4.8c0 3.6-3.8 6.6-6 7.8-2.2-1.2-6-4.2-6-7.8V3.9L9 1.5Z"></path>
                <path d="m6 9 2 2 4-4"></path>
              </svg>{" "}
              On-device transcription <span>·</span> No bot in the room
            </p>
          </div>
          <div
            className="hero-art"
            aria-label="Sample meeting note with decisions and suggested next steps"
          >
            <span className="handwritten top-annotation">
              Less scribbling. More listening.
            </span>
            <svg
              className="annotation-arrow"
              viewBox="0 0 100 100"
              aria-hidden="true"
            >
              <path d="M6 7c69-11 80 43 48 72M42 62l10 21 22-8"></path>
            </svg>
            <div className="back-sheet"></div>
            <article className="hero-note">
              <div className="note-top">
                <span className="note-notebook">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 3h12v14H4zM2 6h4M2 10h4M2 14h4M9 7h4M9 10h4"></path>
                  </svg>{" "}
                  THE STUDIO
                </span>
                <span className="note-top-time">Today, 10:30 AM</span>
              </div>
              <div className="note-content">
                <div className="note-type">
                  <span></span> MEETING NOTES <i>·</i> 32 MIN
                </div>
                <h2>
                  A good idea,
                  <br />
                  getting even better.
                </h2>
                <p className="note-intro">
                  Brand &amp; website catch-up with Jamie
                </p>
                <div className="note-rule"></div>
                <h3>The good stuff</h3>
                <p>
                  We’re taking the new website in a warmer, more personal
                  direction. Think less corporate. More character.
                </p>
                <div className="decision">
                  <span aria-hidden="true">✓</span>
                  <p>
                    <b>Decision made</b>
                    <br />
                    Lead with the story, then show the work.
                  </p>
                </div>
                <h3>Next little steps</h3>
                <div className="sample-check">
                  <span></span> Share the first homepage concepts
                </div>
                <div className="sample-check">
                  <span></span> Pull together a few favorite references
                </div>
                <div className="note-bottom">
                  <span className="avatar">J</span>
                  <span className="avatar avatar-sage">A</span>
                  <span>Two minds. One good plan.</span>
                  <span className="tiny-sparkle" aria-hidden="true">
                    ✳
                  </span>
                </div>
              </div>
            </article>
            <div className="sticky-note">
              <svg
                className="sticky-star"
                viewBox="0 0 40 40"
                aria-hidden="true"
              >
                <path d="m20 2 3 12 11-6-7 12 12 3-13 3 5 11-11-8-8 10 2-14-13-2 13-5L8 7l12 7Z"></path>
              </svg>
              <span className="sticky-label">A little nudge</span>
              <h3>
                Keep the
                <br />
                momentum going.
              </h3>
              <p>
                Turn this catch-up into
                <br />a thoughtful follow-up.
              </p>
              <a href="#your-space">
                See what’s next <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className="mascot-sticker">
              <img
                src="/mascot.png"
                alt="DoodleNote's friendly doodle mascot"
              />
              <span className="handwritten">got it all!</span>
            </div>
          </div>
        </section>
        <div className="promise-strip">
          <div className="wrap promise-inner">
            <span>FOR THE CONVERSATIONS WORTH KEEPING</span>
            <span>
              <i aria-hidden="true">✳</i> Big ideas
            </span>
            <span>
              <i aria-hidden="true">→</i> Little catch-ups
            </span>
            <span>
              <i aria-hidden="true">◎</i> The everyday in between
            </span>
          </div>
        </div>
        <div className="color-band how-band">
          <section id="how-it-works" className="how-section wrap">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  FROM “WAIT, WHAT WAS THAT?” TO “ON IT.”
                </p>
                <h2>
                  A natural flow.
                  <br />A clearer head.
                </h2>
              </div>
              <p>
                Your notes shouldn’t be another thing to manage.
                <br />
                They should help you get on with the good stuff.
              </p>
            </div>
            <div className="flow-grid">
              <article className="flow-card flow-capture">
                <div className="card-number">
                  01 <span>BE THERE</span>
                </div>
                <div className="capture-illustration">
                  <div className="waveform" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <span className="recording-label">
                    <i></i> Listening, from your side
                  </span>
                </div>
                <h3>Stay in the conversation.</h3>
                <p>
                  Jot a thought. Follow a tangent. DoodleNote brings your
                  jottings and transcript together.
                </p>
              </article>
              <article className="flow-card flow-collect">
                <div className="card-number">
                  02 <span>MAKE SENSE OF IT</span>
                </div>
                <div className="collect-illustration">
                  <div className="jot handwritten">
                    new direction!!
                    <br />
                    send ideas to Jamie →
                  </div>
                  <span className="collect-arrow" aria-hidden="true">
                    →
                  </span>
                  <div className="mini-clean">
                    <b>The next direction</b>
                    <span></span>
                    <span></span>
                    <em>✓ Share first concepts</em>
                  </div>
                </div>
                <h3>Find the thread.</h3>
                <p>
                  Clear notes, useful decisions, and the details you’ll want to
                  come back to. All in one place.
                </p>
              </article>
              <article className="flow-card flow-next">
                <div className="card-number">
                  03 <span>KEEP IT MOVING</span>
                </div>
                <div className="next-illustration">
                  <span className="next-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12L10 17L19 7"></path>
                    </svg>
                  </span>
                  <div>
                    <b>A thoughtful next step</b>
                    <span>Draft a recap for Jamie</span>
                  </div>
                  <span aria-hidden="true">→</span>
                </div>
                <h3>A little nudge forward.</h3>
                <p>
                  Turn loose ends into small, clear next steps with Ask in your
                  notebook.
                </p>
              </article>
            </div>
          </section>
        </div>
        <section id="your-space" className="space-section">
          <div className="wrap space-grid">
            <div className="space-copy">
              <p className="eyebrow">A HOME FOR WHAT’S ON YOUR MIND</p>
              <h2>
                Pick up right
                <br />
                where you
                <br />
                <span className="handwritten">left off.</span>
              </h2>
              <p>
                Your latest notes up front, with next steps close by. A quieter
                home base for what’s on your mind.
              </p>
              <span className="handwritten space-annotation">
                A little organized.
                <br />A little doodly. All yours.
              </span>
            </div>
            <div
              className="dashboard-teaser"
              role="img"
              aria-label="Illustration of notes and suggested follow-ups in DoodleNote"
            >
              <div className="teaser-top">
                <span className="teaser-dots">
                  <i></i>
                  <i></i>
                  <i></i>
                </span>
                <span>Your DoodleNote</span>
                <span aria-hidden="true">✳</span>
              </div>
              <div className="teaser-body">
                <div className="teaser-greeting">
                  <div>
                    <span>YOUR DAY, A LITTLE CLEARER</span>
                    <h3>
                      Good morning, Jamie <span aria-hidden="true">☀</span>
                    </h3>
                    <p>A fresh page. A few good things to pick up.</p>
                  </div>
                </div>
                <div className="teaser-grid">
                  <div className="teaser-latest">
                    <div className="teaser-heading">
                      <b>Fresh from your notebook</b>
                      <span>View all →</span>
                    </div>
                    <div className="teaser-note">
                      <span className="teaser-note-icon sage">▤</span>
                      <div>
                        <b>Brand &amp; website catch-up</b>
                        <span>Today · 32 min · The Studio</span>
                      </div>
                      <span>→</span>
                    </div>
                    <div className="teaser-note">
                      <span className="teaser-note-icon peach">☷</span>
                      <div>
                        <b>Ideas for a slower Friday</b>
                        <span>Yesterday · Personal</span>
                      </div>
                      <span>→</span>
                    </div>
                    <div className="teaser-note">
                      <span className="teaser-note-icon yellow">▤</span>
                      <div>
                        <b>Weekly team huddle</b>
                        <span>Yesterday · 24 min · Team</span>
                      </div>
                      <span>→</span>
                    </div>
                  </div>
                  <div className="teaser-followup">
                    <span className="handwritten">
                      Worth a little follow-up
                    </span>
                    <h4>
                      Send Jamie
                      <br />
                      the good stuff.
                    </h4>
                    <p>Your website catch-up has a few ideas ready to share.</p>
                    <span className="teaser-recap">Draft a recap →</span>
                  </div>
                </div>
                <div className="teaser-ask">
                  <span aria-hidden="true">✳</span>
                  <span>What’s on your mind?</span>
                  <span className="teaser-send" aria-hidden="true">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 18V6M7 11L12 6L17 11"></path>
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <div className="color-band values-band">
          <section id="made-for-you" className="values-section wrap">
            <div className="section-heading">
              <div>
                <p className="eyebrow">THOUGHTFUL BY NATURE</p>
                <h2>
                  More room for you.
                  <br />
                  Less noise around you.
                </h2>
              </div>
              <svg
                className="sun-doodle"
                viewBox="0 0 100 100"
                aria-hidden="true"
              >
                <circle cx="50" cy="50" r="24"></circle>
                <path d="M50 3v13m0 68v13M3 50h13m68 0h13M17 17l10 10m46 46 10 10M17 83l10-10m46-46 10-10M40 47v4m20-4v4m-21 9q11 10 22-1"></path>
              </svg>
            </div>
            <div className="value-grid">
              <article>
                <span className="value-icon">⌁</span>
                <h3>Your conversation. Your space.</h3>
                <p>
                  On-device transcription keeps meeting audio on your computer.
                  A more personal way to remember.
                </p>
              </article>
              <article>
                <span className="value-icon">◎</span>
                <h3>No extra face in the call.</h3>
                <p>
                  DoodleNote listens from your side, without adding a meeting
                  bot to the participant list.
                </p>
              </article>
              <article>
                <span className="value-icon">✳</span>
                <h3>Useful, with a little personality.</h3>
                <p>
                  A home for serious work that doesn’t take itself too
                  seriously. Just enough structure. Plenty of you.
                </p>
              </article>
            </div>
          </section>
        </div>
        <section className="closing wrap">
          <div>
            <span className="handwritten">
              For your next “oh, that’s a good idea.”
            </span>
            <h2>
              Make a little
              <br />
              room for the moment.
            </h2>
            <MarketingDownloadButtons className="closing-downloads" />
            <p className="download-caption">
              Free on your device. <a href="/pricing">See plans</a>
            </p>
          </div>
          <div className="closing-mascot">
            <img src="/mascot.png" alt="" />
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <path d="M20 50 8 42m17-14-7-13m34 11 3-16m22 24 12-9"></path>
            </svg>
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
