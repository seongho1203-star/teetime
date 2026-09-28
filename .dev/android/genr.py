import os, re, glob
import pathlib
res = str(pathlib.Path(__file__).resolve().parent.parent.parent / "android/app/src/main/res")
kinds = {}
def add(k, n): kinds.setdefault(k, set()).add(re.sub(r'[^A-Za-z0-9_]', '_', n))
for d in os.listdir(res):
    base = d.split('-')[0]
    if base in ("drawable", "mipmap", "raw", "layout", "xml", "font", "anim"):
        for f in os.listdir(os.path.join(res, d)):
            add(base, f.split('.')[0])
for f in glob.glob(res + "/values*/*.xml"):
    s = open(f).read()
    for tag, name in re.findall(r'<(string|color|style|dimen|bool|integer)\s+name="([^"]+)"', s):
        add(tag, name.replace('.', '_'))
    for name in re.findall(r'<item[^>]*name="([^"]+)"[^>]*type="id"', s): add("id", name)
for f in glob.glob(res + "/layout*/*.xml"):
    for n in re.findall(r'@\+id/([A-Za-z0-9_]+)', open(f).read()): add("id", n)
out = ["package com.kkakkung.app;", "public final class R {"]
i = 0x7f000000
for k, names in kinds.items():
    out.append(f"  public static final class {k} {{")
    for n in sorted(names):
        i += 1; out.append(f"    public static final int {n} = {i};")
    out.append("  }")
out.append("}")
os.makedirs("build/gen/com/kkakkung/app", exist_ok=True)
open("build/gen/com/kkakkung/app/R.java", "w").write("\n".join(out) + "\n")
open("build/gen/com/kkakkung/app/BuildConfig.java", "w").write("""package com.kkakkung.app;
public final class BuildConfig { public static final boolean DEBUG = true; public static final String APPLICATION_ID = "com.kkakkung.app"; public static final String BUILD_TYPE = "debug"; public static final int VERSION_CODE = 1; public static final String VERSION_NAME = "1.0"; public static final String SUPABASE_URL = ""; public static final String SUPABASE_ANON_KEY = ""; }
""")
