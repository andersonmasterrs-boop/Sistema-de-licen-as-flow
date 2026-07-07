bool VerificarLicenca()
{
   string account = IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN));
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string robot = "FLOWWIN.mq5";
   string chave = "LIC-19485815-FLOWWIN";
   string url = "https://seu-dominio.com/api/license/check?format=text"
                + "&account=" + account
                + "&robot=" + robot
                + "&broker=" + broker
                + "&key=" + chave;

   char post[];
   char result[];
   string headers;
   ResetLastError();

   int status = WebRequest("GET", url, "", 8000, post, result, headers);
   if(status == -1)
   {
      Print("Erro WebRequest: ", GetLastError());
      return false;
   }

   string resposta = CharArrayToString(result);
   if(StringFind(resposta, "AUTHORIZED|") == 0)
   {
      Print("Licenca autorizada: ", resposta);
      return true;
   }

   Print("Licenca negada: ", resposta);
   return false;
}
