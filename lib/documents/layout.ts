export const DOCUMENT_EDITOR_PAGE_LAYOUT = {
  pageWidthPx: 816,
  pageHeightPx: 1056,
  pageGapPx: 14,
  marginTopPx: 84,
  marginRightPx: 96,
  marginBottomPx: 84,
  marginLeftPx: 96,
  mobilePaddingXPx: 24,
  mobilePaddingYPx: 24,
} as const;

export const DOCUMENT_EDITOR_CONTENT_HEIGHT_PX =
  DOCUMENT_EDITOR_PAGE_LAYOUT.pageHeightPx -
  DOCUMENT_EDITOR_PAGE_LAYOUT.marginTopPx -
  DOCUMENT_EDITOR_PAGE_LAYOUT.marginBottomPx;

export const DOCUMENT_EDITOR_PAGE_STRIDE_PX =
  DOCUMENT_EDITOR_PAGE_LAYOUT.pageHeightPx + DOCUMENT_EDITOR_PAGE_LAYOUT.pageGapPx;
