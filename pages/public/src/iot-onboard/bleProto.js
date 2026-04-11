import protobuf from 'protobufjs/light';

const root = new protobuf.Root();

// diagnostics_v1 { map<string,string> diagnostics = 1; }
const DiagnosticsMsg = new protobuf.Type('diagnostics_v1')
  .add(new protobuf.MapField('diagnostics', 1, 'string', 'string'));
root.add(DiagnosticsMsg);

// wifi_services_v1 { repeated string services = 1; }
const WifiServicesMsg = new protobuf.Type('wifi_services_v1')
  .add(new protobuf.Field('services', 1, 'string', 'repeated'));
root.add(WifiServicesMsg);

// wifi_connect_v1 { string service = 1; string password = 2; }
const WifiConnectMsg = new protobuf.Type('wifi_connect_v1')
  .add(new protobuf.Field('service', 1, 'string'))
  .add(new protobuf.Field('password', 2, 'string'));
root.add(WifiConnectMsg);

// wifi_remove_v1 { string service = 1; }
const WifiRemoveMsg = new protobuf.Type('wifi_remove_v1')
  .add(new protobuf.Field('service', 1, 'string'));
root.add(WifiRemoveMsg);

export function decodeDiagnostics(buffer) {
  const msg = DiagnosticsMsg.decode(new Uint8Array(buffer));
  return msg.diagnostics || {};
}

export function decodeWifiServices(buffer) {
  const msg = WifiServicesMsg.decode(new Uint8Array(buffer));
  return msg.services || [];
}

export function encodeWifiConnect(ssid, password) {
  return WifiConnectMsg.encode({ service: ssid, password }).finish();
}

export function decodeWifiConnect(buffer) {
  const msg = WifiConnectMsg.decode(new Uint8Array(buffer));
  return { service: msg.service, password: msg.password };
}

export function encodeWifiRemove(ssid) {
  return WifiRemoveMsg.encode({ service: ssid }).finish();
}
