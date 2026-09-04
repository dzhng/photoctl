#include <lcms2.h>
#include <stdio.h>

int main(int argc, char **argv) {
  if (argc != 2) {
    fputs("usage: generate-linear-rec2020-profile <output.icc>\n", stderr);
    return 2;
  }
  cmsCIExyY white = {0.3127, 0.3290, 1.0};
  cmsCIExyYTRIPLE primaries = {
      {0.708, 0.292, 1.0}, {0.170, 0.797, 1.0}, {0.131, 0.046, 1.0}};
  cmsToneCurve *curve = cmsBuildGamma(NULL, 1.0);
  cmsToneCurve *curves[3] = {curve, curve, curve};
  cmsHPROFILE profile = cmsCreateRGBProfileTHR(NULL, &white, &primaries, curves);
  cmsMLU *description = cmsMLUalloc(NULL, 1);
  cmsMLU *copyright = cmsMLUalloc(NULL, 1);
  if (!curve || !profile || !description || !copyright ||
      !cmsMLUsetASCII(description, "en", "US", "photoctl Linear Rec.2020") ||
      !cmsMLUsetASCII(copyright, "en", "US", "Copyright 2026 photoctl contributors; MIT") ||
      !cmsWriteTag(profile, cmsSigProfileDescriptionTag, description) ||
      !cmsWriteTag(profile, cmsSigCopyrightTag, copyright)) {
    fputs("Little CMS could not construct the profile\n", stderr);
    return 1;
  }
  cmsSetProfileVersion(profile, 4.4);
  cmsSetHeaderRenderingIntent(profile, INTENT_RELATIVE_COLORIMETRIC);
  int saved = cmsSaveProfileToFile(profile, argv[1]);
  cmsMLUfree(copyright);
  cmsMLUfree(description);
  cmsCloseProfile(profile);
  cmsFreeToneCurve(curve);
  return saved ? 0 : 1;
}
