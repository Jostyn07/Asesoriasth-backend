const { google } = require('googleapis');
const path = require('path');

async function getAuthenticatedClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'Documentos.json'), // o el nombre de tu archivo de credenciales
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  });
  return await auth.getClient();
}

module.exports = getAuthenticatedClient;