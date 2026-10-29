# flutter_stripe's Android SDK references Stripe's optional push-provisioning
# classes (adding cards to Google Wallet), which are not on the classpath.
# This app never calls push provisioning, so R8 may leave them unresolved.
-dontwarn com.stripe.android.pushProvisioning.**
-dontwarn com.reactnativestripesdk.pushprovisioning.**
