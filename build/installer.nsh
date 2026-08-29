# T-260829-01 - offer repair or remove when an installation is already present.
#
# electron-builder picks this file up by convention: NsisTarget's
# computeCommonInstallerScriptHeader() resolves "installer.nsh" out of
# directories.buildResources (which defaults to "build/") and !includes it
# ahead of the generated installer.nsi, so nothing in package.json wires it.
# It is named installer.nsh rather than pointed at by an explicit
# nsis.include so that the convention stays the one place this lives.
#
# What the templates give us (app-builder-lib/templates/nsis):
#   - installer.nsi inserts `customInit` inside Function .onInit, after
#     initMultiUser has chosen the install mode.
#   - assistedInstaller.nsh inserts `customWelcomePage` as the installer's
#     first page - the slot is empty today, so the installer has no welcome
#     page at all and installSection.nsh removes any existing copy without
#     asking.
# Both macros are inserted only when BUILD_UNINSTALLER is not defined, so
# nothing here runs while the uninstaller is being built or run.
#
# Deliberately absent: anything that deletes user data. The uninstaller keeps
# the database (deleteAppDataOnUninstall is off), the data root is
# relocatable through data-location.json (ADR-006), and an installer that
# resolved a pointer file to a path and deleted it would be the most
# destructive thing in this repository. The page says so out loud instead.

# This same header is compiled a second time to build the uninstaller, where
# neither macro below is inserted. Without this guard every variable declared
# here is unreferenced in that pass, and NSIS's "warning 6001: Variable ...
# not referenced or never set" is fatal under nsis.warningsAsErrors.
!ifndef BUILD_UNINSTALLER

!include LogicLib.nsh
!include WinMessages.nsh
!include nsDialogs.nsh
!include WordFunc.nsh

# Which registry hive the existing installation was found in: "" (none),
# "HKCU" (per-user, the case perMachine:false produces) or "HKLM".
Var solocrmExistingRoot
# InstallLocation, read from ${INSTALL_REGISTRY_KEY}.
Var solocrmExistingLocation
# UninstallString, read from ${UNINSTALL_REGISTRY_KEY} - a *different* key
# from InstallLocation's, and quoted: '"C:\...\Uninstall Solo CRM.exe" /currentuser'.
Var solocrmExistingUninstall
# DisplayVersion, also from ${UNINSTALL_REGISTRY_KEY}. May be absent.
Var solocrmExistingVersion
# "Repair" | "Update" | "Downgrade" - ${VERSION} compared against the above.
Var solocrmActionVerb
# Install-mode flag handed to the old uninstaller so it does not have to guess.
Var solocrmUninstallFlag
# Human-readable scope, so the page never removes a per-machine copy without
# saying that is what it is doing.
Var solocrmScopeText

Var solocrmDialog
Var solocrmRepairRadio
Var solocrmRemoveRadio

/**
 * Record an installation found under one hive, if we have not already found
 * one under a higher-priority hive. HKCU is checked first: with
 * perMachine:false that is the copy this installer produced.
 *
 * An installation counts as present only when the executable is still on
 * disk. A registry key left behind by a failed uninstall would otherwise
 * make the page offer to remove something that is not there.
 */
!macro solocrmDetectIn ROOT LABEL FLAG SCOPE_TEXT
  ${If} $solocrmExistingRoot == ""
    ReadRegStr $0 ${ROOT} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ReadRegStr $1 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ReadRegStr $2 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${If} $0 != ""
    ${AndIf} $1 != ""
    ${AndIf} ${FileExists} "$0\${APP_EXECUTABLE_FILENAME}"
      StrCpy $solocrmExistingRoot "${LABEL}"
      StrCpy $solocrmExistingLocation $0
      StrCpy $solocrmExistingUninstall $1
      StrCpy $solocrmExistingVersion $2
      StrCpy $solocrmUninstallFlag "${FLAG}"
      StrCpy $solocrmScopeText "${SCOPE_TEXT}"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  # Runs in the outer and the UAC inner instance alike. That is safe here and
  # only here: this shows no UI and never calls Quit, so neither instance can
  # hang or double-prompt the other. (initMultiUser, right above, does guard
  # on ${UAC_IsInnerInstance} - it Quits.) Each instance needs its own copy of
  # these variables anyway, since whichever one owns the UI draws the page.
  StrCpy $solocrmExistingRoot ""
  StrCpy $solocrmExistingLocation ""
  StrCpy $solocrmExistingUninstall ""
  StrCpy $solocrmExistingVersion ""
  StrCpy $solocrmActionVerb "Repair"
  StrCpy $solocrmUninstallFlag ""
  StrCpy $solocrmScopeText ""

  # $0-$2 are scratch here: initMultiUser is done with them and nothing
  # between customInit and the first page reads them.
  !insertmacro solocrmDetectIn HKCU "HKCU" "/currentuser" "for you only"
  !insertmacro solocrmDetectIn HKLM "HKLM" "/allusers" "for all users of this computer"

  ${If} $solocrmExistingRoot != ""
  ${AndIf} $solocrmExistingVersion != ""
    ${VersionCompare} "$solocrmExistingVersion" "${VERSION}" $R2
    ${If} $R2 == 1
      # Installed copy is newer than this installer.
      StrCpy $solocrmActionVerb "Downgrade"
    ${ElseIf} $R2 == 2
      StrCpy $solocrmActionVerb "Update"
    ${Else}
      StrCpy $solocrmActionVerb "Repair"
    ${EndIf}
  ${EndIf}
  # No DisplayVersion (a key written by something that is not this installer)
  # leaves the verb at its "Repair" default rather than claiming a direction.
!macroend

!macro customWelcomePage
  Page custom solocrmMaintenancePageCreate solocrmMaintenancePageLeave

  /**
   * Strip the quoted executable path out of a raw UninstallString.
   * In: the raw string on the stack. Out: the path, or "" if unparseable.
   *
   * Concatenating the raw string into an Exec would pass the recorded
   * "/currentuser" tail along as part of the filename.
   */
  Function solocrmUninstallerPath
    Exch $R0
    Push $R1
    Push $R2

    StrCpy $R1 $R0 1
    ${If} $R1 != '"'
      # Unquoted: no arguments can be present, so the whole string is the path.
      Goto solocrmUninstallerPathDone
    ${EndIf}
    StrCpy $R0 $R0 "" 1
    StrCpy $R2 0
    solocrmUninstallerPathLoop:
      StrCpy $R1 $R0 1 $R2
      ${If} $R1 == '"'
        StrCpy $R0 $R0 $R2
        Goto solocrmUninstallerPathDone
      ${EndIf}
      ${If} $R1 == ""
        # Opening quote with no closing quote - refuse rather than guess.
        StrCpy $R0 ""
        Goto solocrmUninstallerPathDone
      ${EndIf}
      IntOp $R2 $R2 + 1
      Goto solocrmUninstallerPathLoop

    solocrmUninstallerPathDone:
    Pop $R2
    Pop $R1
    Exch $R0
  FunctionEnd

  Function solocrmMaintenancePageCreate
    ${If} $solocrmExistingRoot == ""
      # Nothing installed: the first-time flow is unchanged, and a page that
      # told a first-time user nothing would be worse than no page.
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "${PRODUCT_NAME} is already installed" \
      "Choose what this installer should do with the existing installation."

    nsDialogs::Create 1018
    Pop $solocrmDialog
    ${If} $solocrmDialog == error
      Abort
    ${EndIf}

    ${If} $solocrmExistingVersion == ""
      ${NSD_CreateLabel} 0 0 100% 24u \
        "${PRODUCT_NAME} is already installed $solocrmScopeText, in \
$solocrmExistingLocation. This installer carries version ${VERSION}."
    ${Else}
      ${NSD_CreateLabel} 0 0 100% 24u \
        "${PRODUCT_NAME} $solocrmExistingVersion is already installed \
$solocrmScopeText, in $solocrmExistingLocation. This installer carries \
version ${VERSION}."
    ${EndIf}
    Pop $0

    ${NSD_CreateRadioButton} 0 30u 100% 12u \
      "$solocrmActionVerb ${PRODUCT_NAME} to version ${VERSION}"
    Pop $solocrmRepairRadio
    ${NSD_CreateLabel} 12u 43u 96% 20u \
      "The existing copy is replaced. Your database, settings and every \
record stay exactly as they are."
    Pop $0

    ${NSD_CreateRadioButton} 0 70u 100% 12u "Remove ${PRODUCT_NAME}"
    Pop $solocrmRemoveRadio
    ${NSD_CreateLabel} 12u 83u 96% 28u \
      "The application and its shortcuts are uninstalled and nothing is \
installed. Your CRM database is left on disk - removing ${PRODUCT_NAME} \
never deletes your data."
    Pop $0

    ${NSD_SetState} $solocrmRepairRadio ${BST_CHECKED}

    nsDialogs::Show
  FunctionEnd

  Function solocrmMaintenancePageLeave
    ${NSD_GetState} $solocrmRemoveRadio $0
    ${If} $0 != ${BST_CHECKED}
      # Repair / Update / Downgrade: fall through into the ordinary install
      # flow, which already removes the old copy before laying down the new
      # one. The install directory is not offered for an existing install -
      # skipPageIfUpdated governs that and is not fought here.
      Return
    ${EndIf}

    Push $solocrmExistingUninstall
    Call solocrmUninstallerPath
    Pop $1
    ${If} $1 == ""
    ${OrIfNot} ${FileExists} "$1"
      MessageBox MB_OK|MB_ICONSTOP \
        "${PRODUCT_NAME} could not find its uninstaller. Remove it from \
Windows Settings > Apps instead."
      # Stay on the page rather than installing something the user did not ask for.
      Abort
    ${EndIf}

    # The uninstaller copies itself to a temp directory and relaunches unless
    # it is given _?=, in which case it runs in place and ExecWait really
    # waits - but then its own executable is locked and $INSTDIR survives. So
    # do what uninstallOldVersion does: run a copy, from outside the
    # directory being deleted, with _?= pointing back at it. _?= must be the
    # last argument and must not be quoted.
    InitPluginsDir
    ClearErrors
    CopyFiles /SILENT "$1" "$PLUGINSDIR\solocrm-old-uninstaller.exe"
    ${If} ${Errors}
      ClearErrors
      ExecWait '"$1" $solocrmUninstallFlag _?=$solocrmExistingLocation' $0
    ${Else}
      ExecWait '"$PLUGINSDIR\solocrm-old-uninstaller.exe" $solocrmUninstallFlag _?=$solocrmExistingLocation' $0
    ${EndIf}

    ${If} ${Errors}
    ${OrIf} $0 != 0
      # Cancelled or failed: the user is back on the page with both choices
      # still open, and the installer has changed nothing.
      Abort
    ${EndIf}

    # Removing was what the user asked for, so this is a success, not the
    # "user aborted the install" code that Quit alone would leave behind.
    SetErrorLevel 0
    Quit
  FunctionEnd
!macroend

!endif # BUILD_UNINSTALLER
