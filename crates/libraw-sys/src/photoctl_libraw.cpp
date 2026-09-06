#include "photoctl_libraw.h"

#include "libraw/libraw.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <vector>

class PhotoctlLibRaw final : public LibRaw {
  std::vector<ushort> measured_cfa;
  double interpolation_scale[3] = {1., 1., 1.};

public:
  unsigned compression() const {
    const auto &metadata = libraw_internal_data.unpacker_data;
    // Non-TIFF readers have no original TIFF tag; retain their reported value.
    return metadata.tiff_compression_tag ? metadata.tiff_compression_tag
                                         : metadata.tiff_compress;
  }

  int oriented_index(int row, int column) { return flip_index(row, column); }

  float camera_sample(size_t index, int channel) {
    if (!measured_cfa.empty() &&
        channel == FC(index / imgdata.sizes.width, index % imgdata.sizes.width))
      return measured_cfa[index];
    return static_cast<float>(imgdata.image[index][channel] /
                              interpolation_scale[channel]);
  }

  int decode_camera() {
    try {
      const int result = raw2image();
      if (result != LIBRAW_SUCCESS)
        return result;
      adjust_bl();
      subtract_black_internal();
      if (imgdata.idata.filters &&
          (imgdata.idata.filters <= 1000 || imgdata.idata.colors != 3 ||
           imgdata.color.as_shot_wb_applied))
        return LIBRAW_FILE_UNSUPPORTED;
      pre_interpolate();
      // Non-CFA formats (including Sony reduced YCbCr RAW) already contain
      // complete RGB pixels; Bayer interpolation would overwrite real channels.
      if (imgdata.idata.filters) {
        const int a = FC(0, 0), b = FC(0, 1), c = FC(1, 0), d = FC(1, 1);
        if (!((a == 1 && d == 1 && b + c == 2 && b != c) ||
              (b == 1 && c == 1 && a + d == 2 && a != d)))
          return LIBRAW_FILE_UNSUPPORTED;
        for (int row = 0; row < 8; ++row)
          for (int col = 0; col < 2; ++col)
            if (FC(row, col) != FC(row % 2, col))
              return LIBRAW_FILE_UNSUPPORTED;
        double maximum_gain = 0.;
        for (int channel = 0; channel < 3; ++channel) {
          const double gain = imgdata.color.cam_mul[channel];
          if (!std::isfinite(gain) || gain <= 0.)
            return LIBRAW_FILE_UNSUPPORTED;
          maximum_gain = std::max(maximum_gain, gain);
        }
        for (int channel = 0; channel < 3; ++channel) {
          interpolation_scale[channel] =
              imgdata.color.cam_mul[channel] / maximum_gain;
          // Reject a representation that rounds its entire input range to zero.
          // This lower bound also keeps the inverse endpoint below 2^33, so f32
          // can carry it without overflow; there is no photographic gain cap.
          if (65535. * interpolation_scale[channel] < 0.5)
            return LIBRAW_FILE_UNSUPPORTED;
        }
        const size_t count = size_t(imgdata.sizes.width) * imgdata.sizes.height;
        measured_cfa.resize(count);
        for (size_t index = 0; index < count; ++index) {
          const int channel =
              FC(index / imgdata.sizes.width, index % imgdata.sizes.width);
          measured_cfa[index] = imgdata.image[index][channel];
          // Scales <= 1 preserve above-white sensor input without ushort clipping.
          imgdata.image[index][channel] = static_cast<ushort>(
              std::lround(measured_cfa[index] * interpolation_scale[channel]));
        }
        ahd_interpolate();
      }
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
  probe->cfa_colors = raw.imgdata.idata.filters ? raw.imgdata.idata.colors : 0;
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
  result = raw.decode_camera();
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
  if (sample_count > SIZE_MAX / sizeof(float))
    return LIBRAW_TOO_BIG;
  auto *pixels = static_cast<float *>(
      std::malloc(static_cast<size_t>(sample_count) * sizeof(float)));
  if (!pixels)
    return LIBRAW_UNSUFFICIENT_MEMORY;

  uint64_t output = 0;
  for (uint32_t row = 0; row < output_height; ++row) {
    for (uint32_t column = 0; column < output_width; ++column) {
      const auto index = raw.oriented_index(row, column);
      // Preserve physical-grid addressing using LibRaw's sole orientation owner.
      // The origin and two adjacent native pixels define its affine permutation.
      if (index == 0) image->native_origin = output / 3;
      if (index == 1) image->native_x_step = output / 3;
      if (index == source_width) image->native_y_step = output / 3;
      for (int channel = 0; channel < 3; ++channel)
        pixels[output++] = raw.camera_sample(index, channel);
    }
  }

  copy_probe(raw, &image->metadata);
  image->metadata.width = output_width;
  image->metadata.height = output_height;
  image->metadata.black_level = 0;
  image->metadata.orientation = 0;
  image->pixels = pixels;
  image->pixel_count = sample_count;
  image->native_width = source_width;
  image->native_height = source_height;
  image->native_x_step -= image->native_origin;
  image->native_y_step -= image->native_origin;
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
