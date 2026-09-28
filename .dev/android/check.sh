#!/bin/bash
# 안드로이드 코틀린 검사 — 여기서는 구글 저장소가 막혀 진짜 빌드를 못 한다(`CLAUDE.md` 참고).
#   ./check.sh          타입 검사만 (android.jar + 스텁)
#   ./check.sh shots    + 화면을 PNG로 찍는다(Robolectric) → build/shots/
set -o pipefail
cd "$(dirname "$0")"
mkdir -p libs build/shots
[ -s libs/android.jar ] || curl -sSL -o libs/android.jar https://raw.githubusercontent.com/Reginer/aosp-android-jar/main/android-35/android.jar
for a in coil-base coil coil-gif coil-video; do
  [ -s libs/$a.jar ] || { curl -sS -o /tmp/$a.aar https://repo.maven.apache.org/maven2/io/coil-kt/$a/2.7.0/$a-2.7.0.aar && unzip -p /tmp/$a.aar classes.jar > libs/$a.jar; }
done
python3 genr.py
if [ "$1" = "shots" ]; then
  FILTER="--tests shots.Shots"; [ -n "$ALL" ] && FILTER=""   # ALL=1 이면 저장소의 단위 시험도 함께 돈다
  gradle -q --console=plain test $FILTER -Dshots.full="${FULL:-0}" 2>&1 | grep -E "^e: |FAILED|Exception|Caused" | head -40
  ls build/shots
else
  gradle -q --console=plain compileKotlin compileJava compileTestKotlin compileTestJava 2>&1 | grep -E "^e: |error:" | sed 's#file://.*/app/src/main/java/com/kkakkung/app/##' | head -${2:-60}
fi
echo "exit=${PIPESTATUS[0]}"
