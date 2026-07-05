/**
 * Cross-meeting chat smoke: three meetings' notes → "list my recent todos".
 * Run: pnpm --filter @repo/ai global-ask-smoke
 */
import { LOCAL_MODELS } from '../src/catalog'
import { LocalNotesEngine } from '../src/local-engine'
import type { GlobalAskInput } from '../src/global-ask-prompt'

const input: GlobalAskInput = {
  meetings: [
    {
      title: 'Henderson onboarding kickoff',
      dateIso: '2026-07-05T15:00:00Z',
      notesMarkdown: `## Notes
- 40 seats, must finish before Oct 1
## Action items
- [ ] Marcus — schedule network assessment (week one)
- [ ] You — send Henderson the onboarding checklist by Friday`
    },
    {
      title: 'Quarterly planning — ops team',
      dateIso: '2026-07-04T18:00:00Z',
      notesMarkdown: `## Decisions
- Ticketing cutover Aug 15, category freeze Aug 1
## Action items
- [ ] You — confirm final cutover date with vendor
- [ ] Priya — investigate backup job failures, report Friday`
    },
    {
      title: 'Weekly team meeting',
      dateIso: '2026-07-01T16:00:00Z',
      notesMarkdown: `## Notes
- Reviewed spam-filter tickets, all clear
## Decisions
- None`
    }
  ],
  history: [],
  question: 'List my outstanding todos from recent meetings.'
}

const engine = new LocalNotesEngine({ modelUri: LOCAL_MODELS[0]!.uri })
console.log('generating…')
const result = await engine.askAcrossMeetings(input)
console.log('\n================ ANSWER ================\n')
console.log(result.markdown)
console.log('\n=========================================')
console.log(`elapsed: ${(result.elapsedMs / 1000).toFixed(1)}s`)
await engine.dispose()
