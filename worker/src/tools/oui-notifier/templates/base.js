
export function baseEmailTemplate(content) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Helium DC Alerts</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      color: #334155; /* slate-700 */
      margin: 0;
      padding: 0;
      background-color: #f8fafc; /* slate-50 */
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
      margin-top: 20px;
      margin-bottom: 20px;
    }
    .header {
      background-color: #ffffff;
      padding: 24px;
      border-bottom: 1px solid #e2e8f0; /* slate-200 */
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: #0f172a; /* slate-900 */
    }
    .header .subtitle {
      margin-top: 4px;
      font-size: 14px;
      color: #64748b; /* slate-500 */
    }
    .content {
      padding: 32px 24px;
    }
    .footer {
      background-color: #f8fafc; /* slate-50 */
      padding: 24px;
      text-align: center;
      font-size: 12px;
      color: #94a3b8; /* slate-400 */
      border-top: 1px solid #e2e8f0; /* slate-200 */
    }
    .footer a {
      color: #6366f1; /* indigo-500 */
      text-decoration: none;
    }
    .button {
      display: inline-block;
      background-color: #4f46e5; /* indigo-600 */
      color: #ffffff;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      margin-top: 16px;
      margin-bottom: 16px;
    }
    .button:hover {
      background-color: #4338ca; /* indigo-700 */
    }
    .info-box {
      background-color: #f1f5f9; /* slate-100 */
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .label {
      display: inline-block;
      background-color: #e0e7ff; /* indigo-100 */
      color: #3730a3; /* indigo-800 */
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      margin-left: 8px;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 24px;
      margin-bottom: 24px;
    }
    .stat-item {
      background-color: #f8fafc; /* slate-50 */
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #e2e8f0; /* slate-200 */
    }
    .stat-label {
      font-size: 12px;
      color: #64748b; /* slate-500 */
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a; /* slate-900 */
      margin-top: 4px;
    }
    .alert-box {
      background-color: #fff7ed; /* orange-50 */
      border: 1px solid #ffedd5; /* orange-100 */
      color: #9a3412; /* orange-800 */
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Helium DC Alerts</h1>
      <div class="subtitle">OUI Notifier</div>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>Sent by Helium Tools OUI Notifier</p>
      <p>
        <a href="https://heliumtools.org/oui-notifier">Manage Subscription</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}
