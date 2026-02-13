/**
 * Type declarations for the @roamhq/wrtc package.
 * @roamhq/wrtc provides WebRTC APIs for Node.js (maintained fork of wrtc).
 */
declare module '@roamhq/wrtc' {
  export const RTCPeerConnection: typeof globalThis.RTCPeerConnection;
  export const RTCSessionDescription: typeof globalThis.RTCSessionDescription;
  export const RTCIceCandidate: typeof globalThis.RTCIceCandidate;
  export const MediaStream: typeof globalThis.MediaStream;
  export const MediaStreamTrack: typeof globalThis.MediaStreamTrack;
  export const RTCDataChannel: typeof globalThis.RTCDataChannel;
  
  const wrtc: {
    RTCPeerConnection: typeof globalThis.RTCPeerConnection;
    RTCSessionDescription: typeof globalThis.RTCSessionDescription;
    RTCIceCandidate: typeof globalThis.RTCIceCandidate;
    MediaStream: typeof globalThis.MediaStream;
    MediaStreamTrack: typeof globalThis.MediaStreamTrack;
    RTCDataChannel: typeof globalThis.RTCDataChannel;
  };
  
  export default wrtc;
}
