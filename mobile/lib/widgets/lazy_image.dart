import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

/// Lazy-loaded image widget with caching and placeholder
class LazyImage extends StatelessWidget {
  final String? imageUrl;
  final String? placeholder;
  final double? width;
  final double? height;
  final BoxFit fit;
  final Widget? errorWidget;
  final BorderRadius? borderRadius;

  const LazyImage({
    super.key,
    this.imageUrl,
    this.placeholder,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.errorWidget,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    if (imageUrl == null || imageUrl!.isEmpty) {
      return _buildPlaceholder();
    }

    Widget image = CachedNetworkImage(
      imageUrl: imageUrl!,
      width: width,
      height: height,
      fit: fit,
      placeholder: (context, url) => _buildPlaceholder(),
      errorWidget: (context, url, error) => errorWidget ?? _buildPlaceholder(),
      fadeInDuration: const Duration(milliseconds: 200),
      fadeOutDuration: const Duration(milliseconds: 100),
      // Lazy loading: only load when visible
      memCacheWidth: width != null ? (width! * MediaQuery.of(context).devicePixelRatio).round() : null,
      memCacheHeight: height != null ? (height! * MediaQuery.of(context).devicePixelRatio).round() : null,
      // Enhanced caching: cache images for 7 days
      cacheKey: imageUrl,
      maxWidthDiskCache: 1000, // Limit disk cache size
      maxHeightDiskCache: 1000,
    );

    if (borderRadius != null) {
      image = ClipRRect(
        borderRadius: borderRadius!,
        child: image,
      );
    }

    return image;
  }

  Widget _buildPlaceholder() {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.grey[300],
        borderRadius: borderRadius,
      ),
      child: placeholder != null
          ? Center(
              child: Text(
                placeholder!,
                style: TextStyle(
                  color: Colors.grey[600],
                  fontSize: (height ?? 40) * 0.3,
                ),
              ),
            )
          : Icon(
              Icons.person,
              size: (height ?? 40) * 0.6,
              color: Colors.grey[600],
            ),
    );
  }
}

/// Avatar widget with lazy loading
class LazyAvatar extends StatelessWidget {
  final String? imageUrl;
  final String? name;
  final double radius;
  final Color? backgroundColor;

  const LazyAvatar({
    super.key,
    this.imageUrl,
    this.name,
    this.radius = 20,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: backgroundColor ?? Colors.grey[300],
        backgroundImage: CachedNetworkImageProvider(imageUrl!),
        onBackgroundImageError: (exception, stackTrace) {
          // Fallback to initials if image fails
        },
        child: imageUrl == null || imageUrl!.isEmpty
            ? _buildInitials()
            : null,
      );
    }

    return CircleAvatar(
      radius: radius,
      backgroundColor: backgroundColor ?? Theme.of(context).primaryColor,
      child: _buildInitials(),
    );
  }

  Widget _buildInitials() {
    if (name != null && name!.isNotEmpty) {
      return Text(
        name!.substring(0, 1).toUpperCase(),
        style: TextStyle(
          color: Colors.white,
          fontSize: radius * 0.6,
          fontWeight: FontWeight.bold,
        ),
      );
    }
    return Icon(
      Icons.person,
      size: radius * 0.8,
      color: Colors.white,
    );
  }
}

