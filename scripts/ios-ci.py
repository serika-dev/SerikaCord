#!/usr/bin/env python3
"""Helpers for .github/workflows/ios.yml (SerikaCord iOS App Store build).

  python3 scripts/ios-ci.py profile <decoded-profile.plist>
      Validate the App Store provisioning profile against the app (team,
      bundle ID, expiry, push + associated domains), write
      $RUNNER_TEMP/ExportOptions.plist (from mobile/ios/App/ExportOptions.plist)
      and the profile's certificate fingerprints, and export
      IOS_PROFILE_UUID / IOS_PROFILE_NAME.

  python3 scripts/ios-ci.py identity <find-identity-output.txt>
      Pick the keychain identity whose certificate is in the profile; put its
      SHA-1 into ExportOptions.plist and export IOS_SIGNING_IDENTITY.

  python3 scripts/ios-ci.py project
      Switch the App target to manual signing with that identity + profile
      and stamp MARKETING_VERSION / CURRENT_PROJECT_VERSION (target build
      settings only, so Swift package targets are left alone).

  python3 scripts/ios-ci.py google-services <GoogleService-Info.plist>
      Check the Firebase config belongs to this bundle ID.

  python3 scripts/ios-ci.py verify-ipa <export-dir>
      Check the exported IPA (bundle ID, versions, signature files, Firebase
      config, production push entitlement) and copy it to $IPA_PATH.

Environment: RUNNER_TEMP, GITHUB_ENV, APPLE_TEAM_ID, and for the later steps
IOS_VERSION, IOS_BUILD_NUMBER, IOS_PROFILE_NAME, IOS_SIGNING_IDENTITY, IPA_PATH.
"""
import datetime
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

BUNDLE_ID = "dev.serika.serikacord"
ROOT = Path(__file__).resolve().parent.parent
PBXPROJ = ROOT / "mobile/ios/App/App.xcodeproj/project.pbxproj"
ENTITLEMENTS = ROOT / "mobile/ios/App/App/AppRelease.entitlements"
EXPORT_OPTIONS = ROOT / "mobile/ios/App/ExportOptions.plist"


def fail(msg: str) -> None:
    print(f"::error::{msg}")
    sys.exit(1)


def temp() -> Path:
    return Path(os.environ["RUNNER_TEMP"])


def export_env(**values: str) -> None:
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as env:
        for key, value in values.items():
            env.write(f"{key}={value}\n")


def cmd_profile(path: str) -> None:
    team = os.environ["APPLE_TEAM_ID"]
    profile = plistlib.loads(Path(path).read_bytes())
    ent = profile.get("Entitlements", {})
    name = profile.get("Name", "?")
    if team not in profile.get("TeamIdentifier", []):
        fail(f"Provisioning profile '{name}' belongs to team {profile.get('TeamIdentifier')}, expected {team}.")
    if ent.get("application-identifier") != f"{team}.{BUNDLE_ID}":
        fail(f"Provisioning profile '{name}' is for {ent.get('application-identifier')}, expected {team}.{BUNDLE_ID}. "
             "Create an App Store profile for the dev.serika.serikacord App ID.")
    expires = profile["ExpirationDate"]
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    if expires <= now:
        fail(f"Provisioning profile '{name}' expired on {expires:%Y-%m-%d}. Regenerate it and update SERIKACORD_IOS_PROVISIONING_PROFILE_BASE64.")
    if ent.get("get-task-allow"):
        fail(f"Provisioning profile '{name}' is a development profile. Use an App Store Connect distribution profile.")
    if profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices"):
        fail(f"Provisioning profile '{name}' is ad hoc / enterprise. Use an App Store Connect distribution profile.")
    if ent.get("aps-environment") != "production":
        fail(f"Provisioning profile '{name}' has no production push entitlement. "
             "Enable Push Notifications on the App ID, then regenerate the profile.")
    wanted = plistlib.loads(ENTITLEMENTS.read_bytes()).get("com.apple.developer.associated-domains", [])
    allowed = ent.get("com.apple.developer.associated-domains", [])
    if wanted and allowed != "*" and "*" not in allowed and not set(wanted).issubset(allowed):
        fail(f"Provisioning profile '{name}' lacks Associated Domains. Enable it on the App ID, then regenerate the profile.")

    fingerprints = [hashlib.sha1(cert).hexdigest().upper() for cert in profile.get("DeveloperCertificates", [])]
    (temp() / "profile-certificates.json").write_text(json.dumps(fingerprints))
    # The committed ExportOptions.plist (also used for local exports), with
    # this run's team and the profile actually supplied.
    options = plistlib.loads(EXPORT_OPTIONS.read_bytes())
    expected_name = options.get("provisioningProfiles", {}).get(BUNDLE_ID)
    if expected_name and expected_name != name:
        print(f"::warning::Provisioning profile is named '{name}', ExportOptions.plist expects '{expected_name}'. Using '{name}'.")
    options["teamID"] = team
    options["provisioningProfiles"] = {BUNDLE_ID: name}
    (temp() / "ExportOptions.plist").write_bytes(plistlib.dumps(options))
    export_env(IOS_PROFILE_UUID=profile["UUID"], IOS_PROFILE_NAME=re.sub(r"[\r\n]", " ", name))
    print(f"Profile '{name}' ({profile['UUID']}) OK, expires {expires:%Y-%m-%d}")


def cmd_identity(path: str) -> None:
    identities = Path(path).read_text()
    allowed = json.loads((temp() / "profile-certificates.json").read_text())
    matching = [fp for fp in allowed if re.search(r"\b" + fp + r"\b", identities)]
    if not matching:
        fail("The distribution P12 has no certificate (with private key) that the provisioning profile includes. "
             "Regenerate the profile with the team's Apple Distribution certificate, or export the matching P12.")
    options_path = temp() / "ExportOptions.plist"
    options = plistlib.loads(options_path.read_bytes())
    options["signingCertificate"] = matching[0]
    options_path.write_bytes(plistlib.dumps(options))
    export_env(IOS_SIGNING_IDENTITY=matching[0])
    print(f"Signing identity {matching[0]}")


def cmd_project() -> None:
    team = os.environ["APPLE_TEAM_ID"]
    identity = os.environ["IOS_SIGNING_IDENTITY"]
    profile_name = os.environ["IOS_PROFILE_NAME"].replace('"', '\\"')
    version = os.environ["IOS_VERSION"]
    build = os.environ["IOS_BUILD_NUMBER"]
    src = PBXPROJ.read_text()
    # Only the App target's configurations set CODE_SIGN_STYLE.
    count = src.count("CODE_SIGN_STYLE = Automatic;")
    if count != 2:
        fail(f"Expected 2 App target configurations with automatic signing, found {count}.")
    src = src.replace(
        "CODE_SIGN_STYLE = Automatic;",
        f'CODE_SIGN_IDENTITY = "{identity}";\n\t\t\t\tCODE_SIGN_STYLE = Manual;\n'
        f'\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "{profile_name}";',
    )
    src = re.sub(r"DEVELOPMENT_TEAM = [A-Z0-9]+;", f"DEVELOPMENT_TEAM = {team};", src)
    src = re.sub(r"MARKETING_VERSION = [^;]+;", f"MARKETING_VERSION = {version};", src)
    src = re.sub(r"CURRENT_PROJECT_VERSION = [^;]+;", f"CURRENT_PROJECT_VERSION = {build};", src)
    PBXPROJ.write_text(src)
    print(f"App target: manual signing, {version} ({build})")


def cmd_google_services(path: str) -> None:
    try:
        info = plistlib.loads(Path(path).read_bytes())
    except Exception as err:  # noqa: BLE001
        fail(f"IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64 is not a valid plist: {err}")
    if info.get("BUNDLE_ID") != BUNDLE_ID:
        fail(f"GoogleService-Info.plist is for {info.get('BUNDLE_ID')}, expected {BUNDLE_ID}. "
             "Download it from the iOS app in the Firebase project 'serikacord'.")
    if not info.get("GOOGLE_APP_ID") or not info.get("GCM_SENDER_ID"):
        fail("GoogleService-Info.plist is missing GOOGLE_APP_ID / GCM_SENDER_ID.")
    print(f"Firebase project {info.get('PROJECT_ID')} OK")


def cmd_verify_ipa(export_dir: str) -> None:
    files = list(Path(export_dir).glob("*.ipa"))
    if len(files) != 1:
        fail(f"Expected exactly one exported IPA, found {len(files)}.")
    ipa_path = files[0]
    version = os.environ["IOS_VERSION"]
    build = os.environ["IOS_BUILD_NUMBER"]
    with zipfile.ZipFile(ipa_path) as ipa:
        names = ipa.namelist()
        infos = [n for n in names if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", n)]
        if len(infos) != 1:
            fail("IPA is missing its application payload.")
        base = infos[0][: -len("Info.plist")]
        info = plistlib.loads(ipa.read(infos[0]))
        checks = {
            "bundle ID": (info.get("CFBundleIdentifier"), BUNDLE_ID),
            "version": (info.get("CFBundleShortVersionString"), version),
            "build number": (info.get("CFBundleVersion"), build),
            "platform": (info.get("CFBundleSupportedPlatforms"), ["iPhoneOS"]),
        }
        for what, (got, want) in checks.items():
            if got != want:
                fail(f"IPA {what} is {got!r}, expected {want!r}.")
        sdk = info.get("DTSDKName", "")
        if int(re.sub(r"\D.*$", "", sdk.removeprefix("iphoneos")) or 0) < 26:
            fail(f"Built with {sdk}; App Store uploads need the iOS 26 SDK (Xcode 26) or newer.")
        for required in ("embedded.mobileprovision", "_CodeSignature/CodeResources", "GoogleService-Info.plist", "PrivacyInfo.xcprivacy"):
            if base + required not in names:
                fail(f"IPA is missing {required}.")
        tmp = temp() / "ipa-check"
        shutil.rmtree(tmp, ignore_errors=True)
        ipa.extractall(tmp)
    app = tmp / base
    ent_xml = subprocess.run(["codesign", "-d", "--entitlements", ":-", str(app)], capture_output=True, check=True).stdout
    ent = plistlib.loads(ent_xml)
    if ent.get("aps-environment") != "production":
        fail(f"Signed app has aps-environment={ent.get('aps-environment')!r}, expected 'production'.")
    if not ent.get("com.apple.developer.associated-domains"):
        fail("Signed app has no associated domains entitlement.")
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copy2(ipa_path, os.environ["IPA_PATH"])
    print(f"Verified {BUNDLE_ID} {version} ({build}) -> {os.environ['IPA_PATH']}")


def main() -> None:
    if len(sys.argv) < 2:
        fail(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "profile":
        cmd_profile(*args)
    elif cmd == "identity":
        cmd_identity(*args)
    elif cmd == "project":
        cmd_project()
    elif cmd == "google-services":
        cmd_google_services(*args)
    elif cmd == "verify-ipa":
        cmd_verify_ipa(*args)
    else:
        fail(f"Unknown command {cmd}")


if __name__ == "__main__":
    main()
