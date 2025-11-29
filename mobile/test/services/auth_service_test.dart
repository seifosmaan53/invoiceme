// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mocktail/mocktail.dart';

// Local imports - Core
import '../../lib/core/services/api_client.dart';
import '../../lib/core/services/auth_service.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  group('AuthService', () {
    late AuthService authService;
    late MockApiClient mockApiClient;
    late MockSecureStorage mockSecureStorage;

    setUp(() {
      mockApiClient = MockApiClient();
      mockSecureStorage = MockSecureStorage();
      authService = AuthService(mockApiClient, mockSecureStorage);
    });

    test('register should call API with correct data', () async {
      when(() => mockApiClient.post(any(), data: any(named: 'data')))
          .thenAnswer((_) async => Response(
                requestOptions: RequestOptions(path: ''),
                data: {
                  'user': {'id': '123', 'email': 'test@example.com'},
                  'accessToken': 'access_token',
                  'refreshToken': 'refresh_token',
                },
                statusCode: 201,
              ));

      when(() => mockSecureStorage.write(key: any(named: 'key'), value: any(named: 'value')))
          .thenAnswer((_) async => {});

      await authService.register(
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        companyName: 'Test Company',
      );

      verify(() => mockApiClient.post(
            '/auth/register',
            data: {
              'email': 'test@example.com',
              'password': 'password123',
              'name': 'Test User',
              'companyName': 'Test Company',
            },
          )).called(1);
    });

    test('login should call API and store tokens', () async {
      when(() => mockApiClient.post(any(), data: any(named: 'data')))
          .thenAnswer((_) async => Response(
                requestOptions: RequestOptions(path: ''),
                data: {
                  'accessToken': 'access_token',
                  'refreshToken': 'refresh_token',
                  'user': {'id': '123', 'email': 'test@example.com'},
                },
                statusCode: 200,
              ));

      when(() => mockSecureStorage.write(key: any(named: 'key'), value: any(named: 'value')))
          .thenAnswer((_) async => {});

      await authService.login('test@example.com', 'password123');

      verify(() => mockApiClient.post(
            '/auth/login',
            data: {
              'email': 'test@example.com',
              'password': 'password123',
            },
          )).called(1);

      verify(() => mockSecureStorage.write(key: 'access_token', value: 'access_token')).called(1);
      verify(() => mockSecureStorage.write(key: 'refresh_token', value: 'refresh_token')).called(1);
    });

    test('isLoggedIn should return true when token exists', () async {
      when(() => mockSecureStorage.read(key: 'access_token'))
          .thenAnswer((_) async => 'valid_token');

      final result = await authService.isLoggedIn();

      expect(result, isTrue);
    });

    test('isLoggedIn should return false when token does not exist', () async {
      when(() => mockSecureStorage.read(key: 'access_token'))
          .thenAnswer((_) async => null);

      final result = await authService.isLoggedIn();

      expect(result, isFalse);
    });

    test('logout should clear tokens', () async {
      when(() => mockSecureStorage.delete(key: any(named: 'key')))
          .thenAnswer((_) async => {});

      await authService.logout();

      verify(() => mockSecureStorage.delete(key: 'access_token')).called(1);
      verify(() => mockSecureStorage.delete(key: 'refresh_token')).called(1);
    });
  });
}

