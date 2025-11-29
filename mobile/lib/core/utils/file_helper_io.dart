// Mobile implementation - uses dart:io
import 'dart:io';
import 'package:flutter/material.dart';

/// Get FileImage for a file path (mobile only)
ImageProvider? getFileImageProvider(String? path) {
  if (path == null) {
    return null;
  }
  
  try {
    return FileImage(File(path));
  } catch (e) {
    return null;
  }
}

