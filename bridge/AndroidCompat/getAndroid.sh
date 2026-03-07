#!/usr/bin/env bash

# Copyright (C) Contributors to the Suwayomi project
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

# This is a bash script to create android.jar stubs

for dep in "curl" "base64" "zip" "jar"; do
  which $dep >/dev/null 2>&1 || {
    echo >&2 "Error: This script needs $dep installed."
    abort=yes
  }
done

if [ "$abort" = yes ]; then
  echo "Some of the dependencies didn't exist. Aborting."
  exit 1
fi

# foolproof against running from AndroidCompat dir instead of running from project root
if [ "$(basename "$(pwd)")" = "AndroidCompat" ]; then
  cd ..
fi

if [[ "$(basename "$(pwd)")" != "bridge" ]]; then
  echo "Entering bridge directory..."
  cd bridge || {
    echo "Error: cannot find bridge directory."
    exit 1
  }
fi

echo "Getting required Android.jar..."
rm -rf "tmp"
mkdir -p "tmp"
pushd "tmp"

ANDROID_GOOGLESOURCE_URL="https://android.googlesource.com/platform/prebuilts/sdk/+/6cd31be5e4e25901aadf838120d71a79b46d9add/30/public/android.jar?format=TEXT"
ANDROID_PLATFORM_ZIP_URL="https://dl.google.com/android/repository/platform-30_r03.zip"

decode_base64_file() {
  local input_file="$1"
  local output_file="$2"

  if base64 --decode <"$input_file" >"$output_file" 2>/dev/null; then
    return 0
  fi

  if base64 -D -i "$input_file" -o "$output_file" 2>/dev/null; then
    return 0
  fi

  return 1
}

download_from_googlesource() {
  local output_jar="$1"
  local encoded_file="android.jar.b64"

  curl -fL \
    --retry 8 \
    --retry-all-errors \
    --retry-delay 3 \
    --connect-timeout 15 \
    --max-time 180 \
    "$ANDROID_GOOGLESOURCE_URL" \
    -o "$encoded_file" || return 1

  decode_base64_file "$encoded_file" "$output_jar" || return 1
  [ -s "$output_jar" ] || return 1
  return 0
}

download_from_platform_zip() {
  local output_jar="$1"
  local zip_file="platform-30.zip"
  local extracted_path="android-11/android.jar"

  curl -fL \
    --retry 6 \
    --retry-all-errors \
    --retry-delay 3 \
    --connect-timeout 15 \
    --max-time 240 \
    "$ANDROID_PLATFORM_ZIP_URL" \
    -o "$zip_file" || return 1

  jar xf "$zip_file" "$extracted_path" || return 1
  [ -f "$extracted_path" ] || return 1
  mv "$extracted_path" "$output_jar"
  [ -s "$output_jar" ] || return 1
  return 0
}

if ! download_from_googlesource "android.jar"; then
  echo "Primary Android.jar source failed, trying platform ZIP fallback..."
  rm -f android.jar
  if ! download_from_platform_zip "android.jar"; then
    echo "Error: unable to download Android.jar from all configured sources."
    exit 1
  fi
fi

# We need to remove any stub classes that we have implementations for
echo "Patching JAR..."

echo "Removing org.json..."
zip --delete android.jar org/json/*

echo "Removing org.apache..."
zip --delete android.jar org/apache/*

echo "Removing org.w3c..."
zip --delete android.jar org/w3c/*

echo "Removing org.xml..."
zip --delete android.jar org/xml/*

echo "Removing org.xmlpull..."
zip --delete android.jar org/xmlpull/*

echo "Removing junit..."
zip --delete android.jar junit/*

echo "Removing javax..."
zip --delete android.jar javax/*

echo "Removing java..."
zip --delete android.jar java/*

echo "Removing overridden classes..."
zip --delete android.jar android/app/Application.class
zip --delete android.jar android/app/Service.class
zip --delete android.jar android/net/Uri.class
zip --delete android.jar 'android/net/Uri$Builder.class'
zip --delete android.jar android/os/Environment.class
zip --delete android.jar android/text/format/Formatter.class
zip --delete android.jar android/text/Html.class

# Dedup overridden Android classes
ABS_JAR="$(realpath android.jar)"
function dedup() {
  pushd "$1"
  CLASSES="$(find ./* -type f)"
  echo "$CLASSES" | while read -r class; do
    NAME="${class%.*}"
    echo "Processing class: $NAME"
    zip --delete "$ABS_JAR" "$NAME.class" "$NAME\$*.class" "${NAME}Kt.class" "${NAME}Kt\$*.class" >/dev/null
  done
  popd
}

popd
dedup AndroidCompat/src/main/java
dedup app/src/main/kotlin

echo "Copying Android.jar to library folder..."
mkdir -p app/lib/ && rm -f app/lib/android.jar
mv tmp/android.jar app/lib/

echo "Cleaning up..."
rm -rf "tmp"

echo "Done!"
