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

export function encodeWifiRemove(ssid) {
  return WifiRemoveMsg.encode({ service: ssid }).finish();
}

// add_gateway_v1 { string owner = 1; uint64 amount = 2; uint64 fee = 3; string payer = 4; }
// owner and payer are Helium-format base58 address strings (gateway-config
// firmware calls libp2p_crypto:b58_to_bin on these fields).
const AddGatewayReqMsg = new protobuf.Type('add_gateway_v1')
  .add(new protobuf.Field('owner', 1, 'string'))
  .add(new protobuf.Field('amount', 2, 'uint64'))
  .add(new protobuf.Field('fee', 3, 'uint64'))
  .add(new protobuf.Field('payer', 4, 'string'));
root.add(AddGatewayReqMsg);

export function encodeAddGateway(ownerB58, payerB58) {
  return AddGatewayReqMsg.encode({
    owner: ownerB58,
    amount: 0,
    fee: 0,
    payer: payerB58,
  }).finish();
}

export class StaleFirmwareError extends Error {
  constructor(rawResponse) {
    super('Hotspot firmware is too old to sign Solana-era transactions.');
    this.name = 'StaleFirmwareError';
    this.rawResponse = rawResponse;
  }
}
