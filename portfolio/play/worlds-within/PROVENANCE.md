# Provenance, reuse and boundaries

## Generated project content

The JavaScript renderer, interface, Python mesh generators, module geometry, procedural textures, portable exports, UI icons, level layouts, quest logic and optional Unreal source component were authored for this Living Kingdom starter kit. They use no external JavaScript runtime package or remote rendering service. Generated code and generated asset source are provided under the accompanying MIT-style permission notice, to the extent applicable. Third-party source data retains its own terms.

## Earth reference data

`source/earth-reference.json` was carried forward from the earlier Living Kingdom atlas in this conversation. Its country coastline polygons originate from the generalized Natural Earth dataset. Country names, cities and administrative metadata derive from the older bundled countryinfo snapshot noted by that atlas. This build searches its city coordinates; it does not validate those names as current or turn them into real modeled settlements.

Natural Earth publishes its map data as public domain: https://www.naturalearthdata.com/about/terms-of-use/

The original countryinfo MIT notice is preserved in `COUNTRYINFO-LICENSE.txt`. The numerical and name snapshot dates are not verified. There is no claim of current authoritative borders, capital designations or exhaustive coverage. Generalized coastlines can omit small islands. This prototype uses those outlines for geographic orientation only.

The Earth base-colour map is **generated cartographic artwork**, not NASA imagery, Google Earth, an aerial photograph or a satellite tile set. Snow/land colours are artistic heuristics, not climate classifications. Planet textures, the starfield and the spiral-galaxy point distribution are procedurally illustrative. The browser's solar orbits are schematic circular animations, not a date-specific ephemeris.

## Concept artwork

The two images in `reference/` are copies of the AI-generated concept images already present in this conversation. They are retained as visual direction, not represented as actual playable screenshots. No font files are redistributed. The UI uses fonts available on the user's device and original geometric icons.

## Location privacy

The browser calls device geolocation only after the target/location button is pressed. No app-controlled analytics or external data transmission is performed. The browser/OS location service itself may consult network providers. Location permission is never silently assumed. A chosen coordinate merely anchors the same fictional valley; it does not supply real buildings or high-resolution geographic data.

Browser geolocation requirements and permissions: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition

## Testing

`tests/browser-report.json` and `tests/format-report.json` state exactly what was tested. Software-rendered Chromium screenshots show the actual WebGL application. Format validation is structural and numerical, including an independent trimesh GLB read. It is not a Khronos conformance certificate or a successful Unreal/Blender import report. Optional engine code has not been compiled, and Blender scripts have not been executed in Blender here.
