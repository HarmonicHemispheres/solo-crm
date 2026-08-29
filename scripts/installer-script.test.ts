import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * T-260829-01: `build/installer.nsh` is not imported by anything in this
 * repository — electron-builder finds it by convention (NsisTarget's
 * `computeCommonInstallerScriptHeader()` resolves `installer.nsh` out of
 * `directories.buildResources`, which defaults to `build/`) and the NSIS
 * templates call into it through two macro names they insert only
 * `!ifmacrodef`. Nothing errors when a macro is missing or misspelled: the
 * `!ifmacrodef` is simply false, the installer silently reverts to the old
 * behaviour of replacing an existing installation without asking, and
 * `npm run dist` still exits 0.
 *
 * So the names, and the handful of instructions the behaviour actually
 * hangs on, are asserted here — following the precedent of
 * `brand-assets.test.ts`, which guards the other build inputs nothing
 * imports.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const scriptPath = resolve(root, 'build', 'installer.nsh')
const script = readFileSync(scriptPath, 'utf-8')

describe('build/installer.nsh', () => {
  describe('the macro names the NSIS templates insert', () => {
    // installer.nsi: `!ifmacrodef customInit / !insertmacro customInit`,
    // inside Function .onInit.
    it('defines customInit', () => {
      expect(script).toMatch(/^!macro customInit\s*$/m)
    })

    // assistedInstaller.nsh: `!ifmacrodef customWelcomePage`, the
    // installer's first page slot.
    it('defines customWelcomePage', () => {
      expect(script).toMatch(/^!macro customWelcomePage\s*$/m)
    })

    it('balances every !macro with a !macroend', () => {
      const opens = script.match(/^!macro\s+\S+/gm) ?? []
      const closes = script.match(/^!macroend\s*$/gm) ?? []
      expect(closes.length, 'unbalanced !macro / !macroend').toBe(opens.length)
    })
  })

  describe('detection', () => {
    // InstallLocation and UninstallString live under *different* registry
    // keys — INSTALL_REGISTRY_KEY and UNINSTALL_REGISTRY_KEY respectively
    // (app-builder-lib include/installer.nsh, registryAddInstallInfo) — so
    // reading both from one key finds nothing and the page never appears.
    it('reads InstallLocation from INSTALL_REGISTRY_KEY', () => {
      expect(script).toMatch(/ReadRegStr\s+\$\d+\s+\S+\s+"\$\{INSTALL_REGISTRY_KEY\}"\s+"InstallLocation"/)
    })

    it('reads UninstallString and DisplayVersion from UNINSTALL_REGISTRY_KEY', () => {
      expect(script).toMatch(
        /ReadRegStr\s+\$\d+\s+\S+\s+"\$\{UNINSTALL_REGISTRY_KEY\}"\s+"UninstallString"/
      )
      expect(script).toMatch(
        /ReadRegStr\s+\$\d+\s+\S+\s+"\$\{UNINSTALL_REGISTRY_KEY\}"\s+"DisplayVersion"/
      )
    })

    it('checks both hives, per-user first', () => {
      const hkcu = script.indexOf('solocrmDetectIn HKCU')
      const hklm = script.indexOf('solocrmDetectIn HKLM')
      expect(hkcu, 'no HKCU detection').toBeGreaterThan(-1)
      expect(hklm, 'no HKLM detection').toBeGreaterThan(-1)
      expect(hkcu).toBeLessThan(hklm)
    })

    // A registry key left behind by a failed uninstall would otherwise make
    // the page offer to remove something that is not on disk any more.
    it('requires the executable to still exist before treating an install as present', () => {
      expect(script).toMatch(/\$\{FileExists\}\s+"\$0\\\$\{APP_EXECUTABLE_FILENAME\}"/)
    })

    it('words the repair-side choice from the version comparison', () => {
      expect(script).toContain('${VersionCompare} "$solocrmExistingVersion" "${VERSION}"')
      for (const verb of ['Repair', 'Update', 'Downgrade']) {
        expect(script, `no "${verb}" verb`).toContain(`StrCpy $solocrmActionVerb "${verb}"`)
      }
    })
  })

  describe('the page', () => {
    it('is wired to a create and a leave function that both exist', () => {
      const page = script.match(/^\s*Page custom (\S+) (\S+)\s*$/m)
      expect(page, 'no `Page custom` in customWelcomePage').not.toBeNull()
      const [, create, leave] = page!
      expect(script).toMatch(new RegExp(`^\\s*Function ${create}\\s*$`, 'm'))
      expect(script).toMatch(new RegExp(`^\\s*Function ${leave}\\s*$`, 'm'))
    })

    // With nothing installed the flow must be exactly what it is today.
    it('aborts out of the page when no installation was found', () => {
      expect(script).toMatch(/\$\{If\} \$solocrmExistingRoot == ""[\s\S]{0,400}?Abort/)
    })

    it('offers both choices and defaults to the repair side', () => {
      expect(script).toContain('${NSD_CreateRadioButton}')
      expect(script).toContain('"Remove ${PRODUCT_NAME}"')
      expect(script).toContain('${NSD_SetState} $solocrmRepairRadio ${BST_CHECKED}')
    })

    // The uninstaller leaves the database alone; the user has to be able to
    // read that before choosing rather than discover it afterwards.
    it('states on the page that removing does not delete the database', () => {
      expect(script).toMatch(/database is left on disk[\s\S]{0,120}never deletes your data/)
    })

    // Non-ASCII bytes in an NSIS script without a BOM are read in the
    // system code page, so a typographic dash reaches the installed
    // user's screen as mojibake.
    it('is pure ASCII', () => {
      const offending = [...script].filter((c) => c.charCodeAt(0) > 0x7f)
      expect(offending, `non-ASCII characters: ${offending.join(' ')}`).toEqual([])
    })
  })

  describe('the remove path', () => {
    // A bare Exec of UninstallString returns immediately: the uninstaller
    // copies itself to temp and relaunches from there. `_?=` makes it run in
    // place so ExecWait really waits — but then its own exe is locked and
    // the install directory survives, so the copy must be run from
    // $PLUGINSDIR with `_?=` pointing back at the install location. That is
    // what uninstallOldVersion does, and it is the only form that both waits
    // and leaves nothing behind.
    it('runs a copy of the uninstaller with ExecWait and the _?= form', () => {
      expect(script).toContain('CopyFiles /SILENT "$1" "$PLUGINSDIR\\solocrm-old-uninstaller.exe"')
      expect(script).toMatch(
        /ExecWait\s+'"\$PLUGINSDIR\\solocrm-old-uninstaller\.exe" \$solocrmUninstallFlag _\?=\$solocrmExistingLocation'/
      )
      expect(script, 'a bare Exec would not wait').not.toMatch(/^\s*Exec\s+/m)
    })

    // UninstallString is stored quoted and with a trailing install-mode
    // argument, so it is parsed rather than concatenated into the Exec.
    it('parses the executable out of the quoted UninstallString', () => {
      expect(script).toContain('Call solocrmUninstallerPath')
      expect(script).toMatch(/^\s*Function solocrmUninstallerPath\s*$/m)
    })

    it('exits successfully, because removing is what the user chose', () => {
      expect(script).toMatch(/SetErrorLevel 0\s+Quit/)
    })
  })

  // The installer's correct relationship to the data root is no
  // relationship at all: it must never resolve data-location.json, open the
  // database, or hand the uninstaller the flag that deletes app data.
  describe('never touches user data', () => {
    it.each(['--delete-app-data', 'isDeleteAppData', 'solocrm.db', '$APPDATA'])(
      'does not mention %s',
      (needle) => {
        expect(script).not.toContain(needle)
      }
    )

    it('has no RMDir at all', () => {
      expect(script).not.toMatch(/\bRMDir\b/)
    })

    // data-location.json is named in this file's header comment, explaining
    // why it is not read. These are the instructions that would read it.
    it('opens no file of its own', () => {
      expect(script).not.toMatch(/^\s*(FileOpen|FileRead|nsJSON::)/m)
    })
  })
})

describe('package.json wires the NSIS include by convention', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as {
    build: {
      directories?: { buildResources?: string }
      nsis: Record<string, unknown>
    }
  }

  // Both of these are what makes `build/installer.nsh` the file
  // electron-builder picks up. Setting either one elsewhere silently
  // unhooks the maintenance page.
  it('leaves buildResources at its default of build/', () => {
    expect(pkg.build.directories?.buildResources).toBeUndefined()
  })

  it('leaves nsis.include unset, so installer.nsh is found by name', () => {
    expect(pkg.build.nsis.include).toBeUndefined()
  })

  // warningsAsErrors defaults to true. A custom include is exactly the kind
  // of thing that starts emitting NSIS warnings, and those must keep
  // failing `npm run dist` rather than shipping.
  it('does not turn off warningsAsErrors', () => {
    expect(pkg.build.nsis.warningsAsErrors).toBeUndefined()
  })
})
