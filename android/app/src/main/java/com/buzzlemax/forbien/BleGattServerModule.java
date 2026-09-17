package com.buzzlemax.forbien;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.ParcelUuid;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class BleGattServerModule extends ReactContextBaseJavaModule {
    private static final String TAG = "BleGattServerModule";
    private static final String SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
    private static final String CHARACTERISTIC_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
    private static final String KEYSTORE_ALIAS = "ForBienHQMasterKey";
    private static final String PREFS_NAME = "ForBienHQKeystorePrefs";
    private static final String PREF_ENC_KEY = "encrypted_hq_key";
    private static final String PREF_IV = "hq_key_iv";

    private final ReactApplicationContext reactContext;
    private BluetoothManager bluetoothManager;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothGattServer gattServer;
    private AdvertiseCallback advertiseCallback;

    public BleGattServerModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "BleGattServerModule";
    }

    @ReactMethod
    public void isPeripheralSupported(Promise promise) {
        try {
            BluetoothManager manager = (BluetoothManager) reactContext.getSystemService(Context.BLUETOOTH_SERVICE);
            if (manager == null) {
                promise.resolve(false);
                return;
            }
            BluetoothAdapter adapter = manager.getAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                promise.resolve(false);
                return;
            }
            boolean supported = adapter.isMultipleAdvertisementSupported();
            promise.resolve(supported);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void startGattServer(Promise promise) {
        try {
            bluetoothManager = (BluetoothManager) reactContext.getSystemService(Context.BLUETOOTH_SERVICE);
            if (bluetoothManager == null) {
                promise.reject("ERR_BT", "BluetoothManager not available");
                return;
            }
            bluetoothAdapter = bluetoothManager.getAdapter();
            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
                promise.reject("ERR_BT_OFF", "Bluetooth adapter is off or unavailable");
                return;
            }
            // Log adapter state
            Log.d(TAG, "Bluetooth Adapter state: " + (bluetoothAdapter.isEnabled() ? "ENABLED" : "DISABLED"));

            if (gattServer != null) {
                gattServer.close();
                gattServer = null;
            }

            gattServer = bluetoothManager.openGattServer(reactContext, gattServerCallback);
            if (gattServer == null) {
                promise.reject("ERR_GATT_SERVER", "Could not open GATT Server");
                return;
            }

            BluetoothGattService service = new BluetoothGattService(
                    UUID.fromString(SERVICE_UUID),
                    BluetoothGattService.SERVICE_TYPE_PRIMARY
            );

            BluetoothGattCharacteristic characteristic = new BluetoothGattCharacteristic(
                    UUID.fromString(CHARACTERISTIC_UUID),
                    BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE | BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                    BluetoothGattCharacteristic.PERMISSION_WRITE | BluetoothGattCharacteristic.PERMISSION_READ
            );

            service.addCharacteristic(characteristic);
            boolean added = gattServer.addService(service);

            if (added) {
                Log.d(TAG, "GATT Server started and service added successfully");
                promise.resolve(true);
            } else {
                promise.reject("ERR_ADD_SERVICE", "Failed to add GATT Service");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error starting GATT Server", e);
            promise.reject("ERR_START_GATT", e.getMessage());
        }
    }

    @ReactMethod
    public void startAdvertising(String localName, Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                bluetoothManager = (BluetoothManager) reactContext.getSystemService(Context.BLUETOOTH_SERVICE);
                if (bluetoothManager != null) {
                    bluetoothAdapter = bluetoothManager.getAdapter();
                }
            }

            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
                promise.reject("ERR_BT_OFF", "Bluetooth is disabled");
                return;
            }

            advertiser = bluetoothAdapter.getBluetoothLeAdvertiser();
            if (advertiser == null) {
                promise.reject("ERR_NO_ADVERTISER", "BLE Advertising not supported on this device");
                return;
            }

            AdvertiseSettings settings = new AdvertiseSettings.Builder()
                    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                    .setConnectable(true)
                    .setTimeout(0)
                    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                    .build();

            ParcelUuid pUuid = new ParcelUuid(UUID.fromString(SERVICE_UUID));

            AdvertiseData data = new AdvertiseData.Builder()
                    .setIncludeDeviceName(true)
                    .addServiceUuid(pUuid)
                    .build();

            if (advertiseCallback != null) {
                try {
                    advertiser.stopAdvertising(advertiseCallback);
                } catch (Exception ignored) {}
            }

            advertiseCallback = new AdvertiseCallback() {
                @Override
                public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                    super.onStartSuccess(settingsInEffect);
                    Log.d(TAG, "BLE Advertising started successfully");
                    sendEvent("onBleAdvertisingStarted", null);
                }

                @Override
                public void onStartFailure(int errorCode) {
                    super.onStartFailure(errorCode);
                    Log.e(TAG, "BLE Advertising failed with error code: " + errorCode);
                    WritableMap params = Arguments.createMap();
                    params.putInt("errorCode", errorCode);
                    sendEvent("onBleAdvertisingFailed", params);
                }
            };

            if (localName != null && !localName.isEmpty()) {
                try {
                    bluetoothAdapter.setName(localName);
                } catch (Exception e) {
                    Log.w(TAG, "Could not set Bluetooth local name: " + e.getMessage());
                }
            }

            advertiser.startAdvertising(settings, data, advertiseCallback);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start BLE advertising", e);
            promise.reject("ERR_ADVERTISE", e.getMessage());
        }
    }

    @ReactMethod
    public void stopAdvertising(Promise promise) {
        try {
            if (advertiser != null && advertiseCallback != null) {
                advertiser.stopAdvertising(advertiseCallback);
                advertiseCallback = null;
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERR_STOP_ADVERTISE", e.getMessage());
        }
    }

    @ReactMethod
    public void stopGattServer(Promise promise) {
        try {
            if (gattServer != null) {
                gattServer.close();
                gattServer = null;
            }
            stopAdvertising(null);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERR_STOP_GATT", e.getMessage());
        }
    }

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            super.onConnectionStateChange(device, status, newState);
            WritableMap params = Arguments.createMap();
            params.putString("deviceId", device.getAddress());
            params.putString("deviceName", device.getName() != null ? device.getName() : "Unknown");
            params.putInt("status", status);
            params.putInt("newState", newState);

            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.d(TAG, "BLE Central connected to our GATT Server: " + device.getAddress());
                sendEvent("onBleCentralConnected", params);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                Log.d(TAG, "BLE Central disconnected from GATT Server: " + device.getAddress());
                sendEvent("onBleCentralDisconnected", params);
            }
        }

        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId, BluetoothGattCharacteristic characteristic, boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            super.onCharacteristicWriteRequest(device, requestId, characteristic, preparedWrite, responseNeeded, offset, value);

            if (responseNeeded && gattServer != null) {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
            }

            if (value != null && value.length > 0) {
                String base64Data = Base64.encodeToString(value, Base64.NO_WRAP);
                WritableMap params = Arguments.createMap();
                params.putString("deviceId", device.getAddress());
                params.putString("deviceName", device.getName() != null ? device.getName() : "PeerUnit");
                params.putString("dataBase64", base64Data);
                params.putString("characteristicUuid", characteristic.getUuid().toString());
                sendEvent("onBleCharacteristicWrite", params);
            }
        }

        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattCharacteristic characteristic) {
            super.onCharacteristicReadRequest(device, requestId, offset, characteristic);
            if (gattServer != null) {
                byte[] responseValue = "FORBIEN_MESH_NODE".getBytes();
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, responseValue);
            }
        }
    };

    private void sendEvent(String eventName, WritableMap params) {
        if (reactContext.hasActiveCatalystInstance()) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
        }
    }

    @ReactMethod
    public void storeHQPrivateKeyInKeystore(String privateKeyHex, Promise promise) {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
                KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                        KEYSTORE_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build();
                keyGenerator.init(spec);
                keyGenerator.generateKey();
            }

            SecretKey key = (SecretKey) keyStore.getKey(KEYSTORE_ALIAS, null);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] encryptedBytes = cipher.doFinal(privateKeyHex.getBytes(StandardCharsets.UTF_8));

            SharedPreferences prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putString(PREF_ENC_KEY, Base64.encodeToString(encryptedBytes, Base64.NO_WRAP))
                    .putString(PREF_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                    .apply();

            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to store HQ private key in Android Keystore", e);
            promise.reject("ERR_KEYSTORE", e.getMessage());
        }
    }

    @ReactMethod
    public void loadHQPrivateKeyFromKeystore(Promise promise) {
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String encStr = prefs.getString(PREF_ENC_KEY, null);
            String ivStr = prefs.getString(PREF_IV, null);
            if (encStr == null || ivStr == null) {
                promise.resolve(null);
                return;
            }

            byte[] encryptedBytes = Base64.decode(encStr, Base64.NO_WRAP);
            byte[] iv = Base64.decode(ivStr, Base64.NO_WRAP);

            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
                promise.resolve(null);
                return;
            }

            SecretKey key = (SecretKey) keyStore.getKey(KEYSTORE_ALIAS, null);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            GCMParameterSpec gcmSpec = new GCMParameterSpec(128, iv);
            cipher.init(Cipher.DECRYPT_MODE, key, gcmSpec);

            byte[] decryptedBytes = cipher.doFinal(encryptedBytes);
            String privateKeyHex = new String(decryptedBytes, StandardCharsets.UTF_8);
            promise.resolve(privateKeyHex);
        } catch (Exception e) {
            Log.e(TAG, "Failed to load HQ private key from Android Keystore", e);
            promise.reject("ERR_KEYSTORE", e.getMessage());
        }
    }

    @ReactMethod
    public void hasHQPrivateKeyInKeystore(Promise promise) {
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String encStr = prefs.getString(PREF_ENC_KEY, null);
            promise.resolve(encStr != null);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void clearHQPrivateKeyInKeystore(Promise promise) {
        try {
            SharedPreferences prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().clear().apply();
            
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEYSTORE_ALIAS)) {
                keyStore.deleteEntry(KEYSTORE_ALIAS);
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERR_KEYSTORE_CLEAR", e.getMessage());
        }
    }

    @ReactMethod
    public void getAdapterState(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                BluetoothManager manager = (BluetoothManager) reactContext.getSystemService(Context.BLUETOOTH_SERVICE);
                bluetoothAdapter = manager != null ? manager.getAdapter() : null;
            }
            if (bluetoothAdapter == null) {
                promise.resolve("UNAVAILABLE");
            } else if (!bluetoothAdapter.isEnabled()) {
                promise.resolve("DISABLED");
            } else {
                promise.resolve("ENABLED");
            }
        } catch (Exception e) {
            promise.reject("ERR_STATE", e.getMessage());
        }
    }

    @ReactMethod
    public void checkPermissions(Promise promise) {
        try {
            Activity activity = getCurrentActivity();
            if (activity == null) {
                promise.resolve(null);
                return;
            }
            int scan = ContextCompat.checkSelfPermission(activity, android.Manifest.permission.BLUETOOTH_SCAN);
            int connect = ContextCompat.checkSelfPermission(activity, android.Manifest.permission.BLUETOOTH_CONNECT);
            int advertise = ContextCompat.checkSelfPermission(activity, android.Manifest.permission.BLUETOOTH_ADVERTISE);
            int fineLoc = ContextCompat.checkSelfPermission(activity, android.Manifest.permission.ACCESS_FINE_LOCATION);
            WritableMap map = Arguments.createMap();
            map.putBoolean("BLUETOOTH_SCAN", scan == android.content.pm.PackageManager.PERMISSION_GRANTED);
            map.putBoolean("BLUETOOTH_CONNECT", connect == android.content.pm.PackageManager.PERMISSION_GRANTED);
            map.putBoolean("BLUETOOTH_ADVERTISE", advertise == android.content.pm.PackageManager.PERMISSION_GRANTED);
            map.putBoolean("ACCESS_FINE_LOCATION", fineLoc == android.content.pm.PackageManager.PERMISSION_GRANTED);
            promise.resolve(map);
        } catch (Exception e) {
            promise.reject("ERR_PERM", e.getMessage());
        }
    }

    @ReactMethod
    public void requestPermissions(Promise promise) {
        try {
            Activity activity = getCurrentActivity();
            if (activity == null) {
                promise.reject("ERR_ACTIVITY", "Current activity is null");
                return;
            }
            String[] perms = new String[]{
                    android.Manifest.permission.BLUETOOTH_SCAN,
                    android.Manifest.permission.BLUETOOTH_CONNECT,
                    android.Manifest.permission.BLUETOOTH_ADVERTISE,
                    android.Manifest.permission.ACCESS_FINE_LOCATION,
            };
            ActivityCompat.requestPermissions(activity, perms, 1001);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERR_REQ_PERM", e.getMessage());
        }
    }
}
