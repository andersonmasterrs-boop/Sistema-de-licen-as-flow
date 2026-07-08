string LicenseServer = "https://sistema-de-licen-as-flow.vercel.app";
string RobotName = "Rompedor Flow";
string LicenseKey = "LIC-ROMPEDOR-FLOW";

string UrlEncode(string value)
{
   string result = "";
   uchar bytes[];
   StringToCharArray(value, bytes, 0, WHOLE_ARRAY, CP_UTF8);

   for(int i = 0; i < ArraySize(bytes) - 1; i++)
   {
      uchar c = bytes[i];
      if((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~')
         result += CharToString(c);
      else
         result += StringFormat("%%%02X", c);
   }

   return result;
}

bool VerificarLicenca()
{
   string account = IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN));
   string accountName = AccountInfoString(ACCOUNT_NAME);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string accountServer = AccountInfoString(ACCOUNT_SERVER);
   string url = LicenseServer + "/api/license/check?format=text"
                + "&account=" + UrlEncode(account)
                + "&name=" + UrlEncode(accountName)
                + "&robot=" + UrlEncode(RobotName)
                + "&broker=" + UrlEncode(broker)
                + "&server=" + UrlEncode(accountServer)
                + "&key=" + UrlEncode(LicenseKey);

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
      int primeiroSeparador = StringFind(resposta, "|");
      int segundoSeparador = StringFind(resposta, "|", primeiroSeparador + 1);
      if(segundoSeparador >= 0 && StringLen(resposta) > segundoSeparador + 1)
      {
         string mensagemServidor = StringSubstr(resposta, segundoSeparador + 1);
         StringTrimLeft(mensagemServidor);
         StringTrimRight(mensagemServidor);
         if(StringLen(mensagemServidor) > 0)
         {
            Print("Mensagem do servidor: ", mensagemServidor);
            Alert(RobotName, ": ", mensagemServidor);
         }
      }
      return true;
   }

   Print("Licenca negada: ", resposta);
   return false;
}

int OnInit()
{
   if(!VerificarLicenca())
   {
      Alert("Licenca invalida ou expirada para o robo ", RobotName);
      return INIT_FAILED;
   }

   return INIT_SUCCEEDED;
}
