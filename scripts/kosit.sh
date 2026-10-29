#!/usr/bin/env bash
# The XRechnung fixtures (scripts/xrechnung-fixtures.js), checked by the KoSIT
# validator with its XRechnung configuration: the reference check for an
# XRechnung, as a recipient's portal runs it. Any fixture KoSIT does not
# accept fails this script.
#
# Needs Java 11 or later. The validator and the configuration are downloaded
# once into $KOSIT_CACHE (default .kosit/), pinned by version and SHA-256.
#
#   pnpm xrechnung:validate
set -euo pipefail

VALIDATOR_VERSION=1.6.3
VALIDATOR_SHA256=799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9
CONFIG_RELEASE=v2026-08-31
CONFIG_FILE=xrechnung-3.0.2-validator-configuration-2026-08-31.zip
CONFIG_SHA256=2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8

root="$(cd "$(dirname "$0")/.." && pwd)"
cache="${KOSIT_CACHE:-$root/.kosit}"
mkdir -p "$cache"

sha256() {
	if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# fetch <url> <file> <sha256>: download once, and refuse a file that is not the pinned one.
fetch() {
	if [ ! -f "$2" ] || [ "$(sha256 "$2")" != "$3" ]; then
		curl -fsSL --retry 3 -o "$2.part" "$1"
		mv "$2.part" "$2"
	fi
	if [ "$(sha256 "$2")" != "$3" ]; then
		echo "kosit: $2 does not match its pinned SHA-256" >&2
		exit 1
	fi
}

validator="$cache/validator-$VALIDATOR_VERSION-standalone.jar"
fetch "https://github.com/itplr-kosit/validator/releases/download/v$VALIDATOR_VERSION/validator-$VALIDATOR_VERSION-standalone.jar" \
	"$validator" "$VALIDATOR_SHA256"
fetch "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/$CONFIG_RELEASE/$CONFIG_FILE" \
	"$cache/$CONFIG_FILE" "$CONFIG_SHA256"

config="$cache/config-$CONFIG_RELEASE"
if [ ! -f "$config/scenarios.xml" ]; then
	rm -rf "$config"
	mkdir -p "$config"
	unzip -q "$cache/$CONFIG_FILE" -d "$config"
fi

out="$cache/run"
rm -rf "$out"
node "$root/scripts/xrechnung-fixtures.js" "$out/fixtures"

# The validator writes one report per file, prints a table, and exits with
# the number of files it rejects. Without </dev/null it also validates
# whatever is on its standard input.
status=0
java -jar "$validator" -s "$config/scenarios.xml" -r "$config" -o "$out/reports" "$out"/fixtures/*.xml \
	</dev/null >"$out/validator.log" 2>&1 || status=$?
cat "$out/validator.log"

# And each report is read, so a fixture without one counts as rejected too.
rejected=0
total=0
for fixture in "$out"/fixtures/*.xml; do
	name="$(basename "$fixture" .xml)"
	report="$out/reports/$name-report.xml"
	total=$((total + 1))
	if [ -f "$report" ] && grep -q '<rep:assessment><rep:accept' "$report"; then
		echo "accepted  $name"
	else
		echo "REJECTED  $name ($report)"
		rejected=$((rejected + 1))
	fi
done
if [ "$status" -ne 0 ] || [ "$rejected" -gt 0 ]; then
	echo "kosit: $rejected of $total fixtures rejected (validator exit $status)" >&2
	exit 1
fi
echo "kosit: all $total fixtures accepted"
