// ===== IMAGE LAYOUT HELPER =====
// When an <Image resizeMode="contain"> is placed inside a container whose
// aspect ratio is different from the photo's aspect ratio, the photo is
// letterboxed (centered, with empty space on two sides).
//
// RegionBox draws boxes in pixel coordinates starting at (0,0) in the
// TOP-LEFT of whatever rectangle it is given. If we gave it the full
// container, the boxes would be positioned relative to the empty letterbox
// space too, and the saved normalized coordinates would NOT line up with
// the actual photo pixels used for cropping later.
//
// getContainRect() computes the exact rectangle (offset + size) where the
// photo is actually drawn inside the container, matching the same math
// React Native uses for resizeMode="contain". Pass that rectangle's width
// and height to RegionBox as containerWidth/containerHeight, and position
// the RegionBox wrapper View at { left: rect.x, top: rect.y }.

export function getContainRect(containerWidth, containerHeight, naturalWidth, naturalHeight) {
  if (!containerWidth || !containerHeight || !naturalWidth || !naturalHeight) {
    return {
      x: 0,
      y: 0,
      width: containerWidth || 0,
      height: containerHeight || 0,
    };
  }

  const containerRatio = containerWidth / containerHeight;
  const imageRatio = naturalWidth / naturalHeight;

  let width;
  let height;

  if (imageRatio > containerRatio) {
    // Photo is relatively WIDER than the container -> fits to container width,
    // empty space appears above and below
    width = containerWidth;
    height = containerWidth / imageRatio;
  } else {
    // Photo is relatively TALLER than the container -> fits to container height,
    // empty space appears on the left and right
    height = containerHeight;
    width = containerHeight * imageRatio;
  }

  const x = (containerWidth - width) / 2;
  const y = (containerHeight - height) / 2;

  return { x, y, width, height };
}