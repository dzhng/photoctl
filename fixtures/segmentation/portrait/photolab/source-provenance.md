# DxO hero source reconnaissance

For the authorized local qualitative segmentation experiment only. No repository fixture or redistribution license is asserted.

- Official embedding pages: https://www.dxo.com/en/ and https://www.dxo.com/en/dxo-photolab
- Public player: https://player.vimeo.com/video/1212277853
- Video title: Video-FINALE-PL10-V2. Owner metadata: DxO Labs.
- Published video: 1614 x 1080, approximately 16 seconds.
- Acquisition: public player HTML supplies HLS playback URL; ffmpeg decodes that stream directly into temporary PNGs. No login or access bypass.
- `source-t14_5.png`: requested timestamp 14.5 seconds, unmasked image without visible grading panel or comparison divider.
- `hair-overlay-t08_5.png`: requested timestamp 8.5 seconds, green hair overlay with on-image tool marker and cursor.
- Both are complete 1614 x 1080 video frames, without resizing or cropping.
- `contact-sheet.png`: 1 fps inspection samples, downscaled and tiled; fps filter selects nearby samples, so its tile indices are not exact timestamp claims.
- Earlier `source-t14.png` includes a comparison divider. Earlier `hair-overlay-t08.png` is actually an unmasked transition frame with grading panel. Do not use these as the intended pair.

The user screenshot presents the same composition inside a roughly 16:9 clipped hero viewport. The video itself is roughly 3:2; webpage display clips vertical content. The hair, face and flowers correspond, but screenshot coordinates must be registered before overlay comparisons. No screenshot crop was produced here.

Limitations: this is compressed marketing video, not the original still or RAW. Color grading differs across time. The green composite is not a binary/alpha mask; opacity, compression, markers and cursor make it unsuitable as quantitative segmentation truth. ffmpeg reported invalid-NAL messages while probing HLS variants but exited successfully and produced readable PNGs; no bit-perfect decoding claim is made. No segmentation quality conclusion is made.

Rights: https://www.dxo.com/en/company/legal/ reserves rights and requires permission for copying/redistribution. No photographer attribution for this exact image or permissive asset license was located.
