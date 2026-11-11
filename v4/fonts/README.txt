Self-hosted multilingual fonts for the Building 5 guide

These are renamed, character-subset derivatives of Noto Sans, Noto Sans CJK and Noto Sans Symbols 2. They are distributed under SIL Open Font License 1.1. The original license texts are included in this directory. Original copyright/license records are also retained in the font metadata.

The complete source URLs, pinned Git commits, source checksums, output checksums, catalog checksums and coverage result are in manifest.json.

Families
- Guide Sans: Latin, Cyrillic and Vietnamese text; regular and bold.
- Guide CJK KR/SC/TC/JP: region-appropriate Korean, Simplified Chinese, Traditional Chinese and Japanese glyphs; regular and bold.
- Guide Symbols: navigation symbols missing from the other font families.

All current translation characters, the eleven language names and navigation symbols were checked against the generated WOFF2 character maps. The globe emoji and emoji variation selectors use the platform emoji font. Control and format characters are excluded from glyph coverage checks.

Fonts are served from this site's own directory. No Google Fonts or other third-party font request is needed.

Rebuild after translation changes using work/mobile-v7/font-build.py in the development workspace. Source fonts and temporary Python build tools are not included in the service. Coverage checks establish that characters exist in the fonts; browser layout tests and physical-device rendering checks are separate.
