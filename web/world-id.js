import { IDKit, proofOfHuman } from "@worldcoin/idkit-core";
export async function verifyHuman(challenge, onConnect) {
  const { id, signal, ...config } = challenge;
  const request = await IDKit.request(config).preset(proofOfHuman({ signal }));
  onConnect(request.connectorURI);
  const completion = await request.pollUntilCompletion();
  if (!completion.success)
    throw new Error("World ID verification was not completed.");
  return completion.result;
}
