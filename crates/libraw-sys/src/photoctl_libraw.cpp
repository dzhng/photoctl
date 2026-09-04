#include "photoctl_libraw.h"

#include "libraw/libraw.h"

#include <cstdlib>
#include <cstring>

class PhotoctlLibRaw final : public LibRaw {
public:
  unsigned compression() const {
    return libraw_internal_data.unpacker_data.tiff_compress;
  }

  int oriented_index(int row, int column) { return flip_index(row, column); }

  int decode_ahd() {
    try {
      const int result = raw2image();
      if (result != LIBRAW_SUCCESS)
        return result;
      adjust_bl();
      subtract_black_internal();
      pre_interpolate();
      ahd_interpolate();
      return LIBRAW_SUCCESS;
    } catch (const std::bad_alloc &) {
      return LIBRAW_UNSUFFICIENT_MEMORY;
    } catch (...) {
      return LIBRAW_UNSPECIFIED_ERROR;
    }
  }
};

static void copy_probe(const PhotoctlLibRaw &raw, photoctl_libraw_probe *probe) {
  std::memset(probe, 0, sizeof(*probe));
  probe->width = raw.imgdata.sizes.width;
  probe->height = raw.imgdata.sizes.height;
  probe->compression = raw.compression();
  probe->black_level = raw.imgdata.color.black;
  probe->white_level = raw.imgdata.color.maximum;
  std::memcpy(probe->cam_xyz, raw.imgdata.color.cam_xyz,
              sizeof(probe->cam_xyz));
  std::memcpy(probe->as_shot_wb, raw.imgdata.color.cam_mul,
              sizeof(probe->as_shot_wb));
  probe->wb_pre_applied = raw.imgdata.color.as_shot_wb_applied ? 1 : 0;
  probe->orientation = raw.imgdata.sizes.flip;
}

extern "C" int photoctl_libraw_probe_file(const char *path,
                                           photoctl_libraw_probe *probe) {
  if (!path || !probe)
    return LIBRAW_UNSPECIFIED_ERROR;
  PhotoctlLibRaw raw;
  const int result = raw.open_file(path);
  if (result != LIBRAW_SUCCESS)
    return result;
  const int size_result = raw.adjust_sizes_info_only();
  if (size_result != LIBRAW_SUCCESS)
    return size_result;
  raw.adjust_to_raw_inset_crop(1);

  copy_probe(raw, probe);
  return LIBRAW_SUCCESS;
}

extern "C" int photoctl_libraw_decode_file(const char *path,
                                            photoctl_libraw_image *image) {
  if (!path || !image)
    return LIBRAW_UNSPECIFIED_ERROR;
  std::memset(image, 0, sizeof(*image));
  PhotoctlLibRaw raw;
  int result = raw.open_file(path);
  if (result != LIBRAW_SUCCESS)
    return result;
  result = raw.unpack();
  if (result != LIBRAW_SUCCESS)
    return result;
  raw.adjust_to_raw_inset_crop(1);
  raw.imgdata.params.user_qual = 3;
  result = raw.decode_ahd();
  if (result != LIBRAW_SUCCESS)
    return result;
  if (!raw.imgdata.image || raw.imgdata.idata.colors < 3)
    return LIBRAW_FILE_UNSUPPORTED;

  const uint32_t source_width = raw.imgdata.sizes.width;
  const uint32_t source_height = raw.imgdata.sizes.height;
  const bool swaps_axes = (raw.imgdata.sizes.flip & 4) != 0;
  const uint32_t output_width = swaps_axes ? source_height : source_width;
  const uint32_t output_height = swaps_axes ? source_width : source_height;
  const uint64_t sample_count = static_cast<uint64_t>(output_width) *
                                static_cast<uint64_t>(output_height) * 3;
  if (sample_count > SIZE_MAX / sizeof(uint16_t))
    return LIBRAW_TOO_BIG;
  auto *pixels = static_cast<uint16_t *>(
      std::malloc(static_cast<size_t>(sample_count) * sizeof(uint16_t)));
  if (!pixels)
    return LIBRAW_UNSUFFICIENT_MEMORY;

  uint64_t output = 0;
  for (uint32_t row = 0; row < output_height; ++row) {
    for (uint32_t column = 0; column < output_width; ++column) {
      const auto *source = raw.imgdata.image[raw.oriented_index(row, column)];
      pixels[output++] = source[0];
      pixels[output++] = source[1];
      pixels[output++] = source[2];
    }
  }

  copy_probe(raw, &image->metadata);
  image->metadata.width = output_width;
  image->metadata.height = output_height;
  image->metadata.black_level = 0;
  image->metadata.orientation = 0;
  image->pixels = pixels;
  image->pixel_count = sample_count;
  return LIBRAW_SUCCESS;
}

extern "C" void photoctl_libraw_free_image(photoctl_libraw_image *image) {
  if (!image)
    return;
  std::free(image->pixels);
  image->pixels = nullptr;
  image->pixel_count = 0;
}

extern "C" const char *photoctl_libraw_version(void) {
  return LibRaw::version();
}

extern "C" const char *photoctl_libraw_error(int code) {
  return LibRaw::strerror(code);
}
