import { Menu, MenuItem, type BrowserWindow } from 'electron'

/**
 * Right-click menu for the notes editor (and any text in the app). Electron
 * runs the OS spellchecker by default — misspellings already get the red
 * squiggle — but ships no context menu, so without this there is no way to
 * see suggestions, fix a word, or add it to the dictionary.
 */
export function registerContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()

    // Spelling corrections first, exactly like native macOS text fields.
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion)
        })
      )
    }
    if (params.misspelledWord) {
      if (menu.items.length === 0) {
        menu.append(new MenuItem({ label: 'No Guesses Found', enabled: false }))
      }
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(
        new MenuItem({
          label: 'Add to Dictionary',
          click: () =>
            window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        })
      )
      menu.append(new MenuItem({ type: 'separator' }))
    }

    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut' }))
      menu.append(new MenuItem({ role: 'copy' }))
      menu.append(new MenuItem({ role: 'paste' }))
      menu.append(new MenuItem({ role: 'selectAll' }))
    } else if (params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ role: 'copy' }))
    }

    if (menu.items.length > 0) menu.popup()
  })
}
