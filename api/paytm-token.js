const https = require("https");
const PaytmChecksum = require("paytmchecksum");

module.exports = async (req, res) => {
  // CORS headers — allow Flutter mobile app to call this endpoint
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { orderId, amount, customerId } = req.body;

    // ── Set these in Vercel Dashboard → Project → Settings → Environment Variables ──
    const MID = process.env.PAYTM_MID;   // Your Merchant ID
    const MKEY = process.env.PAYTM_MKEY; // Your Merchant Key (SECRET - never in Flutter!)

    if (!MID || !MKEY) {
      return res
        .status(500)
        .json({ error: "PAYTM_MID or PAYTM_MKEY env vars not set on Vercel" });
    }

    // ── Production settings (change IS_STAGING to true only for testing) ──
    const IS_STAGING = false;
    const host = IS_STAGING ? "securegw-stage.paytm.in" : "securegw.paytm.in";
    const website = IS_STAGING ? "WEBSTAGING" : "DEFAULT";

    const paytmParams = {
      body: {
        requestType: "Payment",
        mid: MID,
        websiteName: website,
        orderId: orderId,
        callbackUrl: `https://${host}/theia/paytmCallback?ORDER_ID=${orderId}`,
        txnAmount: {
          value: parseFloat(amount).toFixed(2),
          unit: "INR",
        },
        userInfo: {
          custId: customerId || "GUEST_USER",
        },
      },
    };

    // Sign the request with MKEY (this is why MKEY must NEVER be in Flutter)
    const checksum = await PaytmChecksum.generateSignature(
      JSON.stringify(paytmParams.body),
      MKEY
    );
    paytmParams.head = { signature: checksum };

    const postData = JSON.stringify(paytmParams);

    const options = {
      hostname: host,
      port: 443,
      path: `/theia/api/v1/initiateTransaction?mid=${MID}&orderId=${orderId}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    // Call Paytm API
    const request = https.request(options, (paytmRes) => {
      let data = "";
      paytmRes.on("data", (chunk) => { data += chunk; });
      paytmRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          return res.status(200).json(parsed);
        } catch (err) {
          return res
            .status(500)
            .json({ error: "Failed to parse Paytm response", raw: data });
        }
      });
    });

    request.on("error", (error) => {
      return res.status(500).json({ error: error.message });
    });

    request.write(postData);
    request.end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
