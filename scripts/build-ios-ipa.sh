#!/usr/bin/env bash
#
# Construit un .ipa iOS AUTONOME, non signé, prêt à être installé via SideStore.
#
# SideStore re-signe l'app avec votre Apple ID gratuit et rafraîchit le
# certificat (valide 7 jours) automatiquement par Wi-Fi. On n'a donc PAS
# besoin de compte Apple Developer payant ni de certificat ici.
#
# Prérequis :
#   - macOS + Xcode
#   - CocoaPods : brew install cocoapods
#   - jq
#
# Usage : ./scripts/build-ios-ipa.sh
# Résultat : dist/MyVanInventory-vX.Y.Z.ipa
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_VERSION="$(jq -r '.expo.version' app.json)"
echo "==> Version : $APP_VERSION"

echo "==> Génération du projet natif iOS (expo prebuild)…"
npx expo prebuild --platform ios --no-install

echo "==> Installation des pods…"
( cd ios && pod install )

WORKSPACE="ios/$(ls ios | grep '\.xcworkspace$' | head -1)"
SCHEME="$(xcodebuild -list -workspace "$WORKSPACE" -json | jq -r '.workspace.schemes[0]')"
echo "==> Workspace : $WORKSPACE   Scheme : $SCHEME"

echo "==> Build Release (sans signature)…"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

APP_PATH="$(find ios/build/Build/Products/Release-iphoneos -maxdepth 1 -name '*.app' | head -1)"
echo "==> App construite : $APP_PATH"

echo "==> Empaquetage en .ipa…"
mkdir -p dist
WORK="$(mktemp -d)"
mkdir -p "$WORK/Payload"
cp -R "$APP_PATH" "$WORK/Payload/"
IPA="dist/MyVanInventory-v${APP_VERSION}.ipa"
rm -f "$IPA"
( cd "$WORK" && zip -qry "$ROOT/$IPA" Payload )
rm -rf "$WORK"

echo ""
echo "✅ Terminé : $IPA"
echo "   Transférez ce fichier vers SideStore pour l'installer sur votre iPhone."
