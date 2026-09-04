#ifndef PHOTOCTL_LIBRAW_H
#define PHOTOCTL_LIBRAW_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct photoctl_libraw_probe {
  uint32_t width;
  uint32_t height;
  uint32_t compression;
  uint32_t black_level;
  uint32_t white_level;
  float cam_xyz[12];
  float as_shot_wb[4];
  uint8_t wb_pre_applied;
  int32_t orientation;
} photoctl_libraw_probe;

typedef struct photoctl_libraw_image {
  photoctl_libraw_probe metadata;
  uint16_t *pixels;
  uint64_t pixel_count;
} photoctl_libraw_image;

int photoctl_libraw_probe_file(const char *path, photoctl_libraw_probe *probe);
int photoctl_libraw_decode_file(const char *path, photoctl_libraw_image *image);
void photoctl_libraw_free_image(photoctl_libraw_image *image);
const char *photoctl_libraw_version(void);
const char *photoctl_libraw_error(int code);

#ifdef __cplusplus
}
#endif

#endif
