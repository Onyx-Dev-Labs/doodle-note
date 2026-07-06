/**
 * Note templates — each swaps the OUTPUT FORMAT block of the merge prompt so
 * generated notes come out shaped for the meeting type. The rules block
 * (never invent facts, attribution, tone) is shared and lives in prompt.ts.
 */

export interface NoteTemplate {
  id: string
  label: string
  /** One line shown under the label in the template picker. */
  description: string
  /** The "Output format" block appended to the merge system prompt. */
  outputFormat: string
}

const OMIT = 'omit the section if none'

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'general',
    label: 'General meeting',
    description: 'Summary, notes by topic, decisions, action items',
    outputFormat: `Output format (markdown, nothing before or after it):
# <meeting title>

<1-2 sentence summary of what the meeting was about and its outcome>

## Notes
<the substance, grouped under short bold topic lines following the meeting's flow; bullets, not paragraphs>

## Decisions
<bullet list of decisions actually made; ${OMIT}>

## Action items
<markdown checkboxes: - [ ] Owner — task (deadline if stated); ${OMIT}>`
  },
  {
    id: 'customer-discovery',
    label: 'Customer discovery',
    description: 'Pain points, current setup, requirements, next steps',
    outputFormat: `Output format (markdown, nothing before or after it):
# <meeting title>

<1-2 sentence summary: who the customer is and what they need>

## Company & contacts
<who was on the call, company, roles; only what the transcript supports>

## Situation & pain points
<what hurts today, in their words where possible>

## Current setup
<tools, vendors, environment they described; ${OMIT}>

## Requirements & success criteria
<what a solution must do for them>

## Budget & timeline
<anything said about money or dates; ${OMIT}>

## Risks & objections
<hesitations, blockers, competitors mentioned; ${OMIT}>

## Next steps
<markdown checkboxes: - [ ] Owner — task (deadline if stated)>`
  },
  {
    id: 'site-survey',
    label: 'Site survey / scoping',
    description: 'Site details, existing infra, constraints, open questions, quote items',
    outputFormat: `Output format (markdown, nothing before or after it):
# <meeting title>

<1-2 sentence summary: the site and what the project is>

## Site & scope
<location, areas covered, what the client wants done>

## Existing infrastructure
<equipment, wiring, closets, networks found on site; ${OMIT}>

## Constraints & measurements
<physical constraints, distances, access issues, anything measured; ${OMIT}>

## Open questions for the client
<bullet list of everything that must be answered before quoting>

## Quote considerations
<materials, labor, or line items discussed for the estimate; ${OMIT}>

## Next steps
<markdown checkboxes: - [ ] Owner — task (deadline if stated)>`
  },
  {
    id: 'troubleshooting',
    label: 'Troubleshooting',
    description: 'Issue, symptoms, diagnostics, root cause, resolution',
    outputFormat: `Output format (markdown, nothing before or after it):
# <meeting title>

<1-2 sentence summary: the issue and where it stands>

## Issue
<what is broken, who reported it, impact>

## Environment & symptoms
<systems involved and observed behavior>

## Diagnostics performed
<what was checked and what each check showed>

## Root cause
<the identified cause; ${OMIT} or write "Not yet identified" if discussed but unresolved>

## Resolution / workaround
<what fixed or mitigated it; ${OMIT}>

## Follow-up actions
<markdown checkboxes: - [ ] Owner — task (deadline if stated)>`
  },
  {
    id: 'one-on-one',
    label: '1:1',
    description: 'Wins, challenges, feedback, growth, action items',
    outputFormat: `Output format (markdown, nothing before or after it):
# <meeting title>

<1-2 sentence summary of the conversation>

## Wins
<what went well since last time; ${OMIT}>

## Challenges & blockers
<what is hard or stuck; ${OMIT}>

## Feedback
<feedback exchanged in either direction; ${OMIT}>

## Growth & goals
<career, skills, or goal discussion; ${OMIT}>

## Action items
<markdown checkboxes: - [ ] Owner — task (deadline if stated)>`
  },
  {
    id: 'standup',
    label: 'Team standup',
    description: 'Per-person updates, blockers, cross-team topics',
    outputFormat: `Output format (markdown, nothing before or after it):
# <meeting title>

<1 sentence summary>

## Updates
<one bold line per person or workstream with their done / doing / blocked bullets underneath>

## Blockers
<bullet list of blockers and who owns unblocking them; ${OMIT}>

## Discussion
<anything beyond status updates; ${OMIT}>

## Action items
<markdown checkboxes: - [ ] Owner — task (deadline if stated)>`
  },
  {
    id: 'interview',
    label: 'Interview',
    description: 'Background, assessment, strengths, concerns, recommendation',
    outputFormat: `Output format (markdown, nothing before or after it):
# <meeting title>

<1-2 sentence summary: candidate, role, overall impression as stated by the interviewer>

## Background highlights
<relevant experience and skills they described>

## Assessment
<how they handled the questions; specifics over generalities>

## Strengths
<bullet list>

## Concerns
<bullet list; ${OMIT}>

## Their questions
<what the candidate asked; ${OMIT}>

## Next steps
<markdown checkboxes: - [ ] Owner — task (deadline if stated)>`
  }
]

export function templateById(id: string | undefined): NoteTemplate {
  return NOTE_TEMPLATES.find((t) => t.id === id) ?? NOTE_TEMPLATES[0]!
}
