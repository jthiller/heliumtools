import { verifyEmailTemplate } from "../templates/verify.js";
import { alertEmailTemplate } from "../templates/alert.js";

const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
};

const sampleData = {
    verify: {
        verifyUrl: "https://heliumtools.org/oui-notifier/verify?token=sample-token-123",
        appName: "OUI Notifier",
    },
    alert: {
        label: "My OUI XYZ",
        payerKey: "14h1xJRpb2r7kxLKGhLqwVxjbHfGq2v9xzPLgqYR9jqy",
        oui: 42,
        balanceDC: 15000000,
        balanceUSD: 150.0,
        burn1dDC: 250000,
        burn1dUSD: 2.5,
        daysRemaining: 12,
        threshold: 14,
        appBaseUrl: "https://heliumtools.org/oui-notifier",
        userUuid: "sample-uuid-456",
    },
};

export function handlePreview(templateName) {
    if (templateName === "verify") {
        return new Response(verifyEmailTemplate(sampleData.verify), {
            status: 200,
            headers: htmlHeaders,
        });
    }

    if (templateName === "alert") {
        return new Response(alertEmailTemplate(sampleData.alert), {
            status: 200,
            headers: htmlHeaders,
        });
    }

    const availableTemplates = Object.keys(sampleData);
    return new Response(
        `Template not found. Available templates: ${availableTemplates.join(", ")}`,
        { status: 404, headers: { "Content-Type": "text/plain" } }
    );
}
