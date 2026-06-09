export const LISTING_TYPE_COLORS = {
  매매: '#0072B2',
  전세: '#D55E00',
  월세: '#009E73',
  기타: '#6B7280',
}

export const LISTING_TYPE_CHIP_STYLES = {
  매매: {
    backgroundColor: '#E6F2FA',
    color: '#005A8D',
  },
  전세: {
    backgroundColor: '#FCEBE4',
    color: '#B54800',
  },
  월세: {
    backgroundColor: '#E5F5EF',
    color: '#007A5A',
  },
  기타: {
    backgroundColor: '#F1F5F9',
    color: '#475467',
  },
}

export function getListingTypeColor(type) {
  return LISTING_TYPE_COLORS[type] || LISTING_TYPE_COLORS.기타
}

export function getListingTypeChipStyle(type) {
  return LISTING_TYPE_CHIP_STYLES[type] || LISTING_TYPE_CHIP_STYLES.기타
}
