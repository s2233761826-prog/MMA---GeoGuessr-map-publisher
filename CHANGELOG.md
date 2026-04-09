# Changelog

## v1.0.2
- Fixed an issue where numeric tags such as `2024` could be confused with location counts
- Improved export filename extraction from MMA
- Kept real tag text while removing appended location-count text

## v1.0.1
- Fixed `Gen4` being truncated to `Gen`
- Fixed tags wrapped with separators like `----------------gen4----------------`
- Added export naming as `default filename + tag`
- Improved tag cleaning while preserving numbers inside tags

## v1.0.0
- Initial working version
- Export selected locations from MMA
- Auto-open GeoGuessr map maker
- Auto-fill map name and assist JSON import
