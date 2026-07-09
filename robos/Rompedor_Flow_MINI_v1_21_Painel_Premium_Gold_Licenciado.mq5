//+------------------------------------------------------------------+
//| Rompedor Flow                                                    |
//| Estratégia: rompimento da primeira barra do timeframe escolhido + 1 reversão  |
//| v1.10 - TP real reforçado + resultado por operação no gráfico:  |
//|  FIX1: FecharPosicaoDoRobo: guard fechandoCesta + loop 3->20     |
//|  FIX2: ExecutarEstrategia: bloqueio durante fechandoCesta         |
//|  FIX3: RemoverTPDasCestasAbertas ao entrar em reversão           |
//|  FIX4: VerificarAlvoCesta: ask->bid na verificação do alvo baixo  |
//|  FIX5: Alvo/Stop cesta: guards + reset reversaoJaUsada           |
//|  FIX6: VerificarFechamentoPorTPManual: reseta todos os estados    |
//|  FIX7: VerificarAlvo/Stop movidos antes dos early returns —       |
//|         cesta agora é monitorada mesmo com limite financeiro ativo |
//+------------------------------------------------------------------+
#property strict
#property version   "1.21"
#property description "Rompedor Flow MINI: robô profissional para Mini Índice e Mini Dólar, baseado no rompimento da primeira barra do pregão, com entradas objetivas, controle de risco e gestão automática por canal."
#property description "Versão premium com painel compacto, visual limpo, alvo operacional configurável e leitura rápida dos principais dados da operação."
#property description "Desenvolvido para traders que buscam execução organizada, disciplina operacional e acompanhamento claro dos resultados do dia."

#include <Trade/Trade.mqh>
CTrade trade;

//------------------------- EXPIRAÇÃO DO EA --------------------------
// Altere somente a data abaixo quando quiser liberar ou bloquear a versão.
// Depois dessa data/hora o robô não opera, cancela pendentes e mostra aviso no gráfico.
bool     EA_USAR_EXPIRACAO    = true;
datetime EA_DATA_EXPIRACAO    = D'2030.12.31 23:59';
string   EA_CONTATO_EXPIRACAO = "EA expirado. Entre em contato com a FLOW.";

//------------------------- ENUMS -----------------------------------
enum LadoOperacao { LADO_NENHUM=0, LADO_COMPRA=1, LADO_VENDA=-1 };

enum ModoStopCestaReversao
{
   STOP_NO_CANAL_CONTRARIO = 0,       // Stopa exatamente no canal contrário
   STOP_NA_LINHA_1000      = 1,       // Stopa na linha externa/oposta de 1000 pontos
   STOP_X_PONTOS_REVERSAO  = 2        // Stopa X pontos contra o preço/linha da reversão
};

//------------------------- LICENCIAMENTO ---------------------------
// Campos internos: nao aparecem nos parametros do robo compilado.
string LicenseServer = "https://sistema-de-licen-as-flow.vercel.app";
string RobotName     = "Rompedor Flow";
string LicenseKey    = "LIC-ROMPEDOR-FLOW";
int    LicenseCheckIntervalSeconds = 900; // oculto - revalida licenca e mensagens a cada 15 minutos
string LastLicenseServerMessage = "";
datetime LastPerformanceReportAt = 0;
bool   LicenseFailureMessageShown = false;

//------------------------- PARÂMETROS ------------------------------
input group "Licenca de teste"
input string TelefoneWhatsApp          = ""; // preencha para liberar 7 dias de teste automaticamente

input group "Configuracao Geral"
input ulong  NumeroMagico              = 1255;
input string ComentarioOrdens          = "ROMPEDOR_FLOW";
bool   RemoverGradeDoGrafico     = true;      // oculto - remove a grade do gráfico ao carregar o robô
input ENUM_TIMEFRAMES TimeframePrimeiraBarra = PERIOD_M5; // M5, M15, M30, H1...
input double ContratosInicial          = 1.0;
input bool   UsarReversao              = false;     // true=arma reversão no canal oposto | false=não faz reversão
input double MultiplicadorReversao     = 3.0;      // volume total da reversão = volume líquido atual x multiplicador
bool   UsarReversaoPorPercentualDoAlvo = false; // oculto
double Reversao_Ativar_Quando_Andar_Contra_Percentual_Do_Alvo = 100.0; // oculto
bool   LimitarReversaoProporcionalNoCanalContrario = true; // oculto
int    SlippagePontos            = 20;
input bool   OperarCompras             = true;
input bool   OperarVendas              = true;
input int    MaxOperacoesDia           = 1;         // 0 = sem limite; reversão não conta como nova operação
bool   UsarOrdensPendentes       = true;      // oculto - entradas e reversão por Buy Stop/Sell Stop nas linhas
bool   ExecutarMercadoSeJaRompeu = true;      // oculto - executa a mercado se o canal já estiver rompido
int    JanelaEntradaMercadoAposCanal_Segundos = 60; // oculto
bool   BloquearReentradaMesmoCandle = true; // oculto - após fechar uma operação, não abre nova no mesmo candle


input group "Horários"
input int    HoraPrimeiraBarra         = 9;
input int    MinutoPrimeiraBarra       = 0;
input int    HoraFinalOperacao         = 13;
input int    MinutoFinalOperacao       = 30;
bool   UsarDuracaoJanelaOperacao = false;    // true = ignora horário final e usa duração após fechar a vela do canal
int    DuracaoJanela_Horas       = 6;        // usado quando UsarDuracaoJanelaOperacao=true
int    DuracaoJanela_Minutos     = 0;
bool   FecharNoHorarioFinal      = true;

input group "Filtro da Primeira Barra"
input bool   UsarFiltroTamanhoBarra    = true;
input double TamanhoMinimoBarraPontos  = 200.0;
input double TamanhoMaximoBarraPontos  = 1000.0;

input group "Take Profit por ativo"
input double DistanciaTP_WDO           = 6.0;
input double DistanciaTP_WIN           = 500.0;
input double DistanciaTPReversao_WDO   = 10.0;
input double DistanciaTPReversao_WIN   = 1000.0;
input double DistanciaTP_Outros        = 500.0;
input double DistanciaTPReversao_Outros= 1000.0;

// Forex - TP Adaptativo (oculto)
int    ModoTP_Forex              = 0;      // 0=TP fixo atual | 1=% do canal | 2=multiplicador do canal
double PercentualTP_Canal        = 100.0;   // usado quando ModoTP_Forex=1
double MultiplicadorTP_Canal     = 0.70;   // usado quando ModoTP_Forex=2
double TPMinimo_Pontos           = 0.0;    // 0 = sem mínimo
double TPMaximo_Pontos           = 0.0;    // 0 = sem máximo

// Forex - Lote por Meta (oculto)
int    ModoLote_Forex            = 0;      // 0=lote fixo | 1=calcular lote pela meta financeira
double MetaFinanceiraOperacao    = 1000.0;   // valor desejado no TP da operação inicial
double LoteMinimoCalculado       = 0.01;
double LoteMaximoCalculado       = 50.0;
bool   ArredondarLoteInteiro     = false;  // para Forex normalmente false

input group "Risco Diário"
input bool   UsarStopFinanceiroDia     = true;
input double StopFinanceiroDia         = 500.0;
input bool   UsarMetaFinanceiraDia     = false;
input double MetaFinanceiraDia         = 500.0;

input group "Visual"
input string NomeSecundarioPainel       = "MINI INDICE 9 HORAS 1 CT SEM REVERSAO"; // texto da segunda linha do painel
bool   DesenharHistorico         = true;
int    DiasHistorico             = 20;
int    EspessuraLinhas           = 2;
color  CorLinhaCompra            = clrLime;
color  CorLinhaVenda             = clrTomato;
color  CorLinhaTP                = clrDeepSkyBlue;
color  CorLinhaTPReversao        = clrGold;
color  CorCanal                  = clrSlateGray;
bool   MostrarTextos             = true;
bool   MostrarNumerosCandles     = false;
int    QuantidadeCandlesNumerar  = 120;
int    TamanhoFonteNumeros       = 8;
double DistanciaNumeroPontos     = 80.0;
color  CorNumerosCandles         = clrSilver;
bool   MostrarPainel             = true;
int    PainelX                   = 10;
int    PainelY                   = 25;
int    PainelLargura              = 360;
int    PainelFonteBase            = 8;

bool   MostrarTamanhoCanal       = true;
color  CorTamanhoCanal           = clrYellow;
int    FonteTamanhoCanal         = 14;
int    DeslocamentoTextoCanal_Candles = 2;
int    EspessuraLinhaTamanhoCanal = 2;

bool   MostrarLinhaTPCesta      = true;
color  CorLinhaTPCesta          = clrAqua;
color  CorTextoTPCesta          = clrWhite;
color  CorTextoStopCesta        = clrWhite;
int    FonteTextoTPCesta        = 11;
double DistanciaTextoCesta_Pontos = 10.0;
bool   MostrarLinhaStopCesta    = true;
color  CorLinhaStopCesta        = clrOrangeRed;

// Resultado no Gráfico (oculto)
bool   PlotarResultadoOperacaoNoGrafico = true;
int    AguardarSegundosParaPlotarResultado = 2;
color  CorResultadoPositivo = clrLime;
color  CorResultadoNegativo = clrTomato;
int    FonteResultadoOperacao = 12;
double DistanciaResultadoDoPreco_Pontos = 120.0;

// TP Real / Segurança de Alvo (oculto)
bool   GarantirTPRealOrdemUnica = true;   // oculto
bool   GarantirTPRealCestaQuandoPossivel = true; // oculto

// Stop da Cesta de Reversão (oculto)
bool   UsarStopCestaReversao     = true;
ModoStopCestaReversao ModoStopReversao = STOP_NO_CANAL_CONTRARIO;
double StopCestaReversao_Pontos  = 1000.0;   // usado quando ModoStopReversao = STOP_X_PONTOS_REVERSAO

// Proteção Percentual da Cesta de Reversão (oculto)
bool   Ativar_BreakEven_Cesta = false;   // oculto
double BreakEven_Ativar_Quando_Atingir_Percentual_Do_Alvo = 50.0;
double BreakEven_Proteger_Em_Percentual_Do_Alvo = 0.0;
bool   Ativar_Trailing_Cesta = false;    // oculto
double Trailing_Ativar_Quando_Atingir_Percentual_Do_Alvo = 70.0;
double Trailing_Manter_Distancia_Percentual_Do_Alvo = 20.0;
double Trailing_Atualizar_A_Cada_Percentual_Do_Alvo = 3.0;

// Proteção Percentual da Ordem Única (oculto)
bool   Ativar_BreakEven_Ordem_Unica = false;
double BreakEven_Ordem_Unica_Ativar_Quando_Atingir_Percentual_Do_Alvo = 50.0;
double BreakEven_Ordem_Unica_Proteger_Em_Percentual_Do_Alvo = 0.0;
bool   Ativar_Trailing_Ordem_Unica = false;
double Trailing_Ordem_Unica_Ativar_Quando_Atingir_Percentual_Do_Alvo = 70.0;
double Trailing_Ordem_Unica_Manter_Distancia_Percentual_Do_Alvo = 20.0;
double Trailing_Ordem_Unica_Atualizar_A_Cada_Percentual_Do_Alvo = 3.0;

// Stop da Operação sem Reversão (oculto)
bool   UsarStopOperacaoSemReversao    = true;
ModoStopCestaReversao ModoStopOperacao = STOP_NO_CANAL_CONTRARIO; // 0=canal contrário | 1=linha externa | 2=X pontos
double StopOperacao_Pontos             = 300.0;  // usado quando ModoStopOperacao = STOP_X_PONTOS_REVERSAO

// Filtro de Tendência por Média (oculto)
bool   UsarFiltroMediaTendencia  = false;     // oculto
int    PeriodoMediaTendencia     = 200;
ENUM_TIMEFRAMES TimeframeMediaTendencia = PERIOD_H1;
int    ModoFiltroMediaTendencia  = 1;         // oculto
double DistanciaMinimaMedia_Pontos = 0.0;     // oculto

// Filtro de Reversão por Tamanho do Canal (oculto)
bool   UsarFiltroCanalMinimoReversao = false; // oculto
double CanalMinimoParaReversao_Pontos = 100.0;

//------------------------- VARIÁVEIS -------------------------------

// Controles internos do painel (clicáveis no próprio painel)
bool PainelMostrarResultadoDia    = true;
bool PainelMostrarResultadoSemana = true;
bool PainelMostrarResultadoMes    = true;
bool PainelMostrarResultadoTotal  = true;
#define PAINEL_ZFUNDO  100000000
#define PAINEL_ZTEXTO  100000020
datetime diaAtual = 0;
datetime horarioBaseAtual = 0;
double linhaCompra = 0.0;
double linhaVenda  = 0.0;
bool barraValida = false;
bool estrategiaLiberadaHoje = false;
bool reversaoJaUsada = false;
bool cestaReversaoAtiva = false;
double alvoCestaReversao = 0.0;
double stopCestaReversao = 0.0;
double precoReferenciaCesta = 0.0;
bool beCestaAtivo = false;
bool trailingCestaAtivo = false;
double volumeReversaoCalculado = 0.0;
bool encerradoHorario = false;
LadoOperacao ladoAtual = LADO_NENHUM;
LadoOperacao ultimoLadoExecutado = LADO_NENHUM;
int ciclosExecutadosHoje = 0;
string statusDia = "Aguardando canal";
bool avisoExpiracaoMostrado = false;
bool painelLimpezaInicialFeita = false;
bool fechandoCesta = false;   // trava para evitar reentrada durante fechamento da cesta
bool cicloAtualContabilizado = false;
datetime candleBloqueadoAposFechamento = 0;


// Resultado por ciclo/operação para plotar no gráfico
double resultadoOperacaoPendente = 0.0;
datetime horarioPlotResultado = 0;
datetime horarioUltimoFechamentoOperacao = 0;
double precoUltimoFechamentoOperacao = 0.0;
int contadorResultadosPlotados = 0;

//------------------------- FUNÇÕES AUXILIARES ----------------------
string UrlEncodeLicenca(string value)
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

string MontarUrlLicenca()
{
   string account = IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN));
   string accountName = AccountInfoString(ACCOUNT_NAME);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string accountServer = AccountInfoString(ACCOUNT_SERVER);
   string server = LicenseServer;

   while(StringLen(server) > 0 && StringSubstr(server, StringLen(server) - 1, 1) == "/")
      server = StringSubstr(server, 0, StringLen(server) - 1);

   return server + "/api/license/check?format=text"
          + "&account=" + UrlEncodeLicenca(account)
          + "&name=" + UrlEncodeLicenca(accountName)
          + "&robot=" + UrlEncodeLicenca(RobotName)
          + "&broker=" + UrlEncodeLicenca(broker)
          + "&server=" + UrlEncodeLicenca(accountServer)
          + "&key=" + UrlEncodeLicenca(LicenseKey)
          + "&phone=" + UrlEncodeLicenca(TelefoneWhatsApp);
}

bool VerificarLicencaOnline()
{
   LicenseFailureMessageShown = false;
   if(StringLen(LicenseServer) <= 0 || StringLen(LicenseKey) <= 0)
   {
      Print("Licenca nao configurada: informe LicenseServer e LicenseKey.");
      return false;
   }

   string url = MontarUrlLicenca();
   char post[];
   char result[];
   string headers;
   ResetLastError();

   int status = WebRequest("GET", url, "", 8000, post, result, headers);
   if(status == -1)
   {
      int erro = GetLastError();
      Print("Erro WebRequest na verificacao de licenca: ", erro);
      Print("Libere a URL em Ferramentas > Opcoes > Expert Advisors: ", LicenseServer);
      LicenseFailureMessageShown = true;
      Alert("WebRequest nao liberado. No MT5 acesse Ferramentas > Opcoes > Expert Advisors, marque 'Permitir WebRequest para URL listada' e adicione esta URL: ", LicenseServer);
      return false;
   }

   string resposta = CharArrayToString(result);
   StringTrimLeft(resposta);
   StringTrimRight(resposta);

   if(status == 200 && StringFind(resposta, "AUTHORIZED|") == 0)
   {
      Print("Licenca autorizada para ", RobotName, ". Conta: ", AccountInfoInteger(ACCOUNT_LOGIN));
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
            if(mensagemServidor != LastLicenseServerMessage)
            {
               LastLicenseServerMessage = mensagemServidor;
               Alert(RobotName, ": ", mensagemServidor);
            }
         }
      }
      return true;
   }

   string mensagemNegada = "";
   int primeiroSeparadorNegado = StringFind(resposta, "|");
   int segundoSeparadorNegado = (primeiroSeparadorNegado >= 0 ? StringFind(resposta, "|", primeiroSeparadorNegado + 1) : -1);
   if(segundoSeparadorNegado >= 0 && StringLen(resposta) > segundoSeparadorNegado + 1)
   {
      mensagemNegada = StringSubstr(resposta, segundoSeparadorNegado + 1);
      StringTrimLeft(mensagemNegada);
      StringTrimRight(mensagemNegada);
   }

   Print("Licenca negada. HTTP=", status, " Resposta=", resposta);
   if(StringLen(mensagemNegada) > 0)
   {
      LicenseFailureMessageShown = true;
      Alert(RobotName, ": ", mensagemNegada);
   }
   return false;
}

string DataAtualISO()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   return StringFormat("%04d-%02d-%02d", dt.year, dt.mon, dt.day);
}

string ValorUrl(double value)
{
   return DoubleToString(value, 2);
}

bool EnviarPerformanceOnline()
{
   if(StringLen(LicenseServer) <= 0 || StringLen(LicenseKey) <= 0)
      return false;

   string server = LicenseServer;
   while(StringLen(server) > 0 && StringSubstr(server, StringLen(server) - 1, 1) == "/")
      server = StringSubstr(server, 0, StringLen(server) - 1);

   string account = IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN));
   string url = server + "/api/performance/report?format=text"
          + "&account=" + UrlEncodeLicenca(account)
          + "&robot=" + UrlEncodeLicenca(RobotName)
          + "&key=" + UrlEncodeLicenca(LicenseKey)
          + "&symbol=" + UrlEncodeLicenca(_Symbol)
          + "&date=" + UrlEncodeLicenca(DataAtualISO())
          + "&profitDay=" + UrlEncodeLicenca(ValorUrl(ResultadoDiaRobo()))
          + "&profitWeek=" + UrlEncodeLicenca(ValorUrl(ResultadoSemanaRobo()))
          + "&profitMonth=" + UrlEncodeLicenca(ValorUrl(ResultadoMesRobo()))
          + "&profitTotal=" + UrlEncodeLicenca(ValorUrl(ResultadoTotalRobo()))
          + "&tradesDay=" + IntegerToString(TradesDiaRobo())
          + "&volumeDay=" + UrlEncodeLicenca(ValorUrl(VolumeDiaRobo()));

   char post[];
   char result[];
   string headers;
   ResetLastError();

   int status = WebRequest("GET", url, "", 8000, post, result, headers);
   if(status == -1)
   {
      Print("Erro WebRequest ao enviar performance: ", GetLastError());
      return false;
   }

   string resposta = CharArrayToString(result);
   StringTrimLeft(resposta);
   StringTrimRight(resposta);
   if(status == 200 && resposta == "OK")
   {
      LastPerformanceReportAt = TimeCurrent();
      Print("Performance enviada para o sistema de licencas. Conta: ", account, " Ativo: ", _Symbol);
      return true;
   }

   Print("Performance nao enviada. HTTP=", status, " Resposta=", resposta);
   return false;
}

datetime InicioDoDia(datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   return StructToTime(dt);
}

datetime MontarHorario(datetime dia, int hora, int minuto)
{
   MqlDateTime dt;
   TimeToStruct(dia, dt);
   dt.hour = hora; dt.min = minuto; dt.sec = 0;
   return StructToTime(dt);
}

int SegundosTimeframeCanal()
{
   int segundosTF = PeriodSeconds(TimeframePrimeiraBarra);
   if(segundosTF <= 0) segundosTF = 300;
   return segundosTF;
}

datetime InicioOperacaoParaDia(datetime dia)
{
   return MontarHorario(dia, HoraPrimeiraBarra, MinutoPrimeiraBarra) + SegundosTimeframeCanal();
}

datetime FimOperacaoParaDia(datetime dia)
{
   datetime inicioOperacao = InicioOperacaoParaDia(dia);

   if(UsarDuracaoJanelaOperacao)
   {
      int duracao = MathMax(1, DuracaoJanela_Horas * 3600 + DuracaoJanela_Minutos * 60);
      return inicioOperacao + duracao;
   }

   datetime fim = MontarHorario(dia, HoraFinalOperacao, MinutoFinalOperacao);
   if(fim <= inicioOperacao)
      fim += 86400; // horário final menor que o início = termina no dia seguinte

   return fim;
}

datetime DiaBaseOperacional(datetime agora)
{
   datetime hoje = InicioDoDia(agora);
   datetime inicioHoje = InicioOperacaoParaDia(hoje);

   if(agora >= inicioHoje)
      return hoje;

   datetime ontem = hoje - 86400;
   datetime fimOntem = FimOperacaoParaDia(ontem);
   if(agora <= fimOntem)
      return ontem;

   return hoje;
}

bool SimboloEhWDO()
{
   string s = _Symbol;
   StringToUpper(s);
   return (StringFind(s, "WDO") >= 0 || StringFind(s, "DOL") >= 0);
}

bool SimboloEhWIN()
{
   string s = _Symbol;
   StringToUpper(s);
   return (StringFind(s, "WIN") >= 0 || StringFind(s, "IND") >= 0);
}

double DistanciaTPFixo(bool reversao)
{
   if(SimboloEhWDO()) return reversao ? DistanciaTPReversao_WDO : DistanciaTP_WDO;
   if(SimboloEhWIN()) return reversao ? DistanciaTPReversao_WIN : DistanciaTP_WIN;
   return reversao ? DistanciaTPReversao_Outros : DistanciaTP_Outros;
}

double AplicarLimitesTP(double pontos)
{
   if(TPMinimo_Pontos > 0.0) pontos = MathMax(pontos, TPMinimo_Pontos);
   if(TPMaximo_Pontos > 0.0) pontos = MathMin(pontos, TPMaximo_Pontos);
   return MathMax(pontos, _Point > 0.0 ? 1.0 : pontos);
}

double DistanciaTPPorCanal(bool reversao, double highCanal, double lowCanal)
{
   double fixo = DistanciaTPFixo(reversao);
   if(ModoTP_Forex <= 0) return fixo;

   double canalPontos = MathAbs(highCanal - lowCanal) / _Point;
   if(canalPontos <= 0.0) return fixo;

   double pontos = fixo;
   if(ModoTP_Forex == 1)
      pontos = canalPontos * (PercentualTP_Canal / 100.0);
   else if(ModoTP_Forex == 2)
      pontos = canalPontos * MultiplicadorTP_Canal;

   return AplicarLimitesTP(pontos);
}

double DistanciaTP(bool reversao)
{
   if(linhaCompra > 0.0 && linhaVenda > 0.0)
      return DistanciaTPPorCanal(reversao, linhaCompra, linhaVenda);
   return DistanciaTPFixo(reversao);
}



double TamanhoCanalPontos()
{
   if(linhaCompra <= 0.0 || linhaVenda <= 0.0) return 0.0;
   return MathAbs(linhaCompra - linhaVenda) / _Point;
}

double DistanciaReversaoPorAlvoPontos()
{
   double alvo = DistanciaTP(false);
   double pct = MathMax(0.0, Reversao_Ativar_Quando_Andar_Contra_Percentual_Do_Alvo) / 100.0;
   double pontos = alvo * pct;

   // Correção v1.14aa:
   // Quando o limitador estiver ligado, a distância proporcional da reversão
   // nunca pode ser maior que a distância até o lado oposto do canal.
   // Assim a pendente de reversão nunca nasce fora do canal.
   if(LimitarReversaoProporcionalNoCanalContrario)
   {
      double canalPts = TamanhoCanalPontos();
      if(canalPts > 0.0)
         pontos = MathMin(pontos, canalPts);
   }

   return MathMax(pontos, 1.0);
}

double PrecoReversaoParaVenda()
{
   if(!UsarReversaoPorPercentualDoAlvo)
      return NormalizarPreco(linhaVenda);

   double preco = linhaCompra - DistanciaReversaoPorAlvoPontos() * _Point;

   // Segurança extra após normalização/arredondamento do ativo:
   // venda de reversão nunca pode ficar abaixo da mínima do canal quando limitado.
   if(LimitarReversaoProporcionalNoCanalContrario)
      preco = MathMax(preco, linhaVenda);

   return NormalizarPreco(preco);
}

double PrecoReversaoParaCompra()
{
   if(!UsarReversaoPorPercentualDoAlvo)
      return NormalizarPreco(linhaCompra);

   double preco = linhaVenda + DistanciaReversaoPorAlvoPontos() * _Point;

   // Segurança extra após normalização/arredondamento do ativo:
   // compra de reversão nunca pode ficar acima da máxima do canal quando limitado.
   if(LimitarReversaoProporcionalNoCanalContrario)
      preco = MathMin(preco, linhaCompra);

   return NormalizarPreco(preco);
}

bool EntradaBloqueadaNesteCandle()
{
   if(!BloquearReentradaMesmoCandle) return false;
   if(candleBloqueadoAposFechamento <= 0) return false;
   return (iTime(_Symbol, _Period, 0) == candleBloqueadoAposFechamento);
}

bool JanelaEntradaMercadoInicialAtiva()
{
   if(!ExecutarMercadoSeJaRompeu) return false;
   if(horarioBaseAtual <= 0) return false;

   datetime fimFormacaoCanal = horarioBaseAtual + SegundosTimeframeCanal();
   int janela = MathMax(0, JanelaEntradaMercadoAposCanal_Segundos);
   datetime agora = TimeCurrent();
   return (agora >= fimFormacaoCanal && agora <= fimFormacaoCanal + janela);
}

double CalcularVolumeInicial()
{
   if(ModoLote_Forex <= 0)
      return NormalizarVolume(ContratosInicial);

   double distanciaPontos = DistanciaTP(false);
   double distanciaPreco = MathAbs(distanciaPontos * _Point);
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);

   if(distanciaPreco <= 0.0 || tickSize <= 0.0 || tickValue <= 0.0 || MetaFinanceiraOperacao <= 0.0)
      return NormalizarVolume(ContratosInicial);

   double lucroPorLote = (distanciaPreco / tickSize) * tickValue;
   if(lucroPorLote <= 0.0)
      return NormalizarVolume(ContratosInicial);

   double vol = MathAbs(MetaFinanceiraOperacao) / lucroPorLote;

   if(LoteMinimoCalculado > 0.0) vol = MathMax(vol, LoteMinimoCalculado);
   if(LoteMaximoCalculado > 0.0) vol = MathMin(vol, LoteMaximoCalculado);
   if(ArredondarLoteInteiro) vol = MathMax(1.0, MathRound(vol));

   return NormalizarVolume(vol);
}

string NomeModoStopReversao()
{
   if(ModoStopReversao == STOP_NO_CANAL_CONTRARIO) return "Canal contrário";
   if(ModoStopReversao == STOP_X_PONTOS_REVERSAO) return "X pontos";
   return "Linha 1000";
}

double CalcularStopCestaReversao(LadoOperacao ladoLiquido)
{
   // ladoLiquido = lado que ficou dominante depois da reversão.
   // Exemplo: reversão para VENDA foi acionada na linhaVenda.
   if(ladoLiquido == LADO_COMPRA)
   {
      if(ModoStopReversao == STOP_NO_CANAL_CONTRARIO)
         return NormalizarPreco(linhaVenda);

      if(ModoStopReversao == STOP_X_PONTOS_REVERSAO)
         return NormalizarPreco(linhaCompra - StopCestaReversao_Pontos * _Point);

      return NormalizarPreco(linhaVenda - DistanciaTPFixo(true) * _Point);
   }

   if(ladoLiquido == LADO_VENDA)
   {
      if(ModoStopReversao == STOP_NO_CANAL_CONTRARIO)
         return NormalizarPreco(linhaCompra);

      if(ModoStopReversao == STOP_X_PONTOS_REVERSAO)
         return NormalizarPreco(linhaVenda + StopCestaReversao_Pontos * _Point);

      return NormalizarPreco(linhaCompra + DistanciaTPFixo(true) * _Point);
   }

   return 0.0;
}

double CalcularStopOperacaoInicial(LadoOperacao ladoEntrada)
{
   // Usado somente quando UsarReversao=false.
   // Se a reversão estiver ligada, o lado contrário do canal é usado para armar a reversão, não como SL da entrada.
   if(!UsarStopOperacaoSemReversao || UsarReversao) return 0.0;

   if(ladoEntrada == LADO_COMPRA)
   {
      if(ModoStopOperacao == STOP_NO_CANAL_CONTRARIO)
         return NormalizarPreco(linhaVenda);

      if(ModoStopOperacao == STOP_X_PONTOS_REVERSAO)
         return NormalizarPreco(linhaCompra - StopOperacao_Pontos * _Point);

      // Linha externa: stop fica X/1000 pontos abaixo do canal contrário.
      return NormalizarPreco(linhaVenda - DistanciaTPFixo(true) * _Point);
   }

   if(ladoEntrada == LADO_VENDA)
   {
      if(ModoStopOperacao == STOP_NO_CANAL_CONTRARIO)
         return NormalizarPreco(linhaCompra);

      if(ModoStopOperacao == STOP_X_PONTOS_REVERSAO)
         return NormalizarPreco(linhaVenda + StopOperacao_Pontos * _Point);

      // Linha externa: stop fica X/1000 pontos acima do canal contrário.
      return NormalizarPreco(linhaCompra + DistanciaTPFixo(true) * _Point);
   }

   return 0.0;
}

string NomeModoStopOperacao()
{
   if(ModoStopOperacao == STOP_NO_CANAL_CONTRARIO) return "Canal contrário";
   if(ModoStopOperacao == STOP_X_PONTOS_REVERSAO) return "X pontos";
   return "Linha externa";
}

double NormalizarPreco(double p)
{
   return NormalizeDouble(p, _Digits);
}

double NormalizarVolume(double vol)
{
   double minv = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxv = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0) step = 1.0;
   vol = MathMax(minv, MathMin(maxv, vol));
   return MathFloor(vol / step) * step;
}


double CalcularVolumeReversao(double volumeLiquidoAtual)
{
   if(volumeLiquidoAtual <= 0.0)
      return 0.0;

   double mult = MathMax(0.0, MultiplicadorReversao);
   if(mult <= 0.0)
      return 0.0;

   return NormalizarVolume(volumeLiquidoAtual * mult);
}

bool TemPosicaoDoRobo(ENUM_POSITION_TYPE &tipo, double &volume, double &preco)
{
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != NumeroMagico) continue;
      tipo = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      volume = PositionGetDouble(POSITION_VOLUME);
      preco = PositionGetDouble(POSITION_PRICE_OPEN);
      return true;
   }
   return false;
}


bool ObterCestaDoRobo(double &volCompra, double &volVenda, double &precoMedioCompra, double &precoMedioVenda)
{
   volCompra = 0.0;
   volVenda = 0.0;
   precoMedioCompra = 0.0;
   precoMedioVenda = 0.0;
   double somaCompra = 0.0;
   double somaVenda = 0.0;

   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != NumeroMagico) continue;

      ENUM_POSITION_TYPE tipo = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double volume = PositionGetDouble(POSITION_VOLUME);
      double preco  = PositionGetDouble(POSITION_PRICE_OPEN);

      if(tipo == POSITION_TYPE_BUY)
      {
         volCompra += volume;
         somaCompra += volume * preco;
      }
      else if(tipo == POSITION_TYPE_SELL)
      {
         volVenda += volume;
         somaVenda += volume * preco;
      }
   }

   if(volCompra > 0.0) precoMedioCompra = somaCompra / volCompra;
   if(volVenda > 0.0) precoMedioVenda = somaVenda / volVenda;
   return (volCompra > 0.0 || volVenda > 0.0);
}

bool FecharPosicaoDoRobo()
{
   if(fechandoCesta) return false;
   fechandoCesta = true;
   CancelarPendentesDoRobo();
   bool ok = true;
   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetDeviationInPoints(SlippagePontos);
   for(int tentativa=0; tentativa<20; tentativa++)
   {
      bool achou = false;
      for(int i=PositionsTotal()-1; i>=0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0) continue;
         if(!PositionSelectByTicket(ticket)) continue;
         if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
         if((ulong)PositionGetInteger(POSITION_MAGIC) != NumeroMagico) continue;
         achou = true;
         if(!trade.PositionClose(ticket, SlippagePontos)) ok = false;
      }
      if(!achou) break;
   }
   fechandoCesta = false;
   return ok;
}

double ResultadoDiaRobo()
{
   return ResultadoPeriodoRobo(InicioDoDia(TimeCurrent()), TimeCurrent());
}

bool LimiteFinanceiroAtingido()
{
   double res = ResultadoDiaRobo();
   if(UsarStopFinanceiroDia && res <= -MathAbs(StopFinanceiroDia)) return true;
   if(UsarMetaFinanceiraDia && res >=  MathAbs(MetaFinanceiraDia)) return true;
   return false;
}

bool CarregarPrimeiraBarra(datetime dia, double &high, double &low, datetime &baseTime)
{
   baseTime = MontarHorario(dia, HoraPrimeiraBarra, MinutoPrimeiraBarra);
   int shift = iBarShift(_Symbol, TimeframePrimeiraBarra, baseTime, false);
   if(shift < 0) return false;
   datetime t = iTime(_Symbol, TimeframePrimeiraBarra, shift);
   if(t != baseTime) return false;
   high = iHigh(_Symbol, TimeframePrimeiraBarra, shift);
   low  = iLow(_Symbol, TimeframePrimeiraBarra, shift);
   if(high <= 0 || low <= 0 || high <= low) return false;
   return true;
}

bool ValidarTamanhoBarra(double high, double low)
{
   if(!UsarFiltroTamanhoBarra) return true;
   double tamanho = (high - low) / _Point;
   return (tamanho >= TamanhoMinimoBarraPontos && tamanho <= TamanhoMaximoBarraPontos);
}

double TamanhoCanalAtualPontos()
{
   if(linhaCompra <= 0.0 || linhaVenda <= 0.0) return 0.0;
   return MathAbs(linhaCompra - linhaVenda) / _Point;
}

bool CanalPermiteReversao()
{
   if(!UsarFiltroCanalMinimoReversao) return true;
   return (TamanhoCanalAtualPontos() >= CanalMinimoParaReversao_Pontos);
}

double ValorMediaTendencia()
{
   if(!UsarFiltroMediaTendencia || PeriodoMediaTendencia <= 0) return 0.0;
   int handle = iMA(_Symbol, TimeframeMediaTendencia, PeriodoMediaTendencia, 0, MODE_EMA, PRICE_CLOSE);
   if(handle == INVALID_HANDLE) return 0.0;
   double buffer[];
   ArraySetAsSeries(buffer, true);
   int copied = CopyBuffer(handle, 0, 0, 1, buffer);
   IndicatorRelease(handle);
   if(copied <= 0) return 0.0;
   return buffer[0];
}

bool FiltroMediaPermite(LadoOperacao lado)
{
   if(!UsarFiltroMediaTendencia) return true;
   double media = ValorMediaTendencia();
   if(media <= 0.0) return true;

   double preco = (SymbolInfoDouble(_Symbol, SYMBOL_BID) + SymbolInfoDouble(_Symbol, SYMBOL_ASK)) / 2.0;
   double distPts = MathAbs(preco - media) / _Point;
   if(DistanciaMinimaMedia_Pontos > 0.0 && distPts < DistanciaMinimaMedia_Pontos) return false;

   bool tendenciaAlta = (preco > media);
   bool favor = ((lado == LADO_COMPRA && tendenciaAlta) || (lado == LADO_VENDA && !tendenciaAlta));

   if(ModoFiltroMediaTendencia == 2) return !favor; // só contra
   return favor; // padrão: só a favor
}

string NomeFiltroMedia()
{
   if(!UsarFiltroMediaTendencia) return "Desligado";
   if(ModoFiltroMediaTendencia == 2) return "Contra média";
   return "A favor da média";
}

datetime InicioDaSemana(datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   datetime dia = InicioDoDia(t);
   int dow = dt.day_of_week; // 0=domingo, 1=segunda
   int voltar = (dow == 0 ? 6 : dow - 1);
   return dia - voltar * 86400;
}

double ResultadoPeriodoRobo(datetime ini, datetime fim)
{
   if(!HistorySelect(ini, fim)) return 0.0;
   double total = 0.0;
   for(int i=HistoryDealsTotal()-1; i>=0; i--)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if(HistoryDealGetString(deal, DEAL_SYMBOL) != _Symbol) continue;
      if((ulong)HistoryDealGetInteger(deal, DEAL_MAGIC) != NumeroMagico) continue;
      total += HistoryDealGetDouble(deal, DEAL_PROFIT)
             + HistoryDealGetDouble(deal, DEAL_SWAP)
             + HistoryDealGetDouble(deal, DEAL_COMMISSION);
   }
   return total;
}

double ResultadoSemanaRobo()
{
   return ResultadoPeriodoRobo(InicioDaSemana(TimeCurrent()), TimeCurrent());
}

datetime InicioDoMes(datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   dt.day = 1;
   dt.hour = 0;
   dt.min = 0;
   dt.sec = 0;
   return StructToTime(dt);
}

double ResultadoMesRobo()
{
   return ResultadoPeriodoRobo(InicioDoMes(TimeCurrent()), TimeCurrent());
}

double ResultadoTotalRobo()
{
   return ResultadoPeriodoRobo(0, TimeCurrent());
}

int TradesPeriodoRobo(datetime ini, datetime fim)
{
   if(!HistorySelect(ini, fim)) return 0;
   int total = 0;
   for(int i=HistoryDealsTotal()-1; i>=0; i--)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if(HistoryDealGetString(deal, DEAL_SYMBOL) != _Symbol) continue;
      if((ulong)HistoryDealGetInteger(deal, DEAL_MAGIC) != NumeroMagico) continue;
      if((long)HistoryDealGetInteger(deal, DEAL_ENTRY) == DEAL_ENTRY_OUT) total++;
   }
   return total;
}

int TradesDiaRobo()
{
   return TradesPeriodoRobo(InicioDoDia(TimeCurrent()), TimeCurrent());
}

double VolumePeriodoRobo(datetime ini, datetime fim)
{
   if(!HistorySelect(ini, fim)) return 0.0;
   double total = 0.0;
   for(int i=HistoryDealsTotal()-1; i>=0; i--)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if(HistoryDealGetString(deal, DEAL_SYMBOL) != _Symbol) continue;
      if((ulong)HistoryDealGetInteger(deal, DEAL_MAGIC) != NumeroMagico) continue;
      ENUM_DEAL_ENTRY entradaDeal = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(entradaDeal != DEAL_ENTRY_OUT && entradaDeal != DEAL_ENTRY_INOUT && entradaDeal != DEAL_ENTRY_OUT_BY)
         continue;
      total += HistoryDealGetDouble(deal, DEAL_VOLUME);
   }
   return total;
}

double VolumeDiaRobo()
{
   return VolumePeriodoRobo(InicioDoDia(TimeCurrent()), TimeCurrent());
}

int TradesSemanaRobo()
{
   return TradesPeriodoRobo(InicioDaSemana(TimeCurrent()), TimeCurrent());
}

void CriarLinha(string nome, datetime t1, datetime t2, double preco, color cor, int estilo=STYLE_SOLID)
{
   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_TREND, 0, t1, preco, t2, preco);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, cor);
   ObjectSetInteger(0, nome, OBJPROP_WIDTH, EspessuraLinhas);
   ObjectSetInteger(0, nome, OBJPROP_STYLE, estilo);
   ObjectSetInteger(0, nome, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectMove(0, nome, 0, t1, preco);
   ObjectMove(0, nome, 1, t2, preco);
}

void CriarTexto(string nome, datetime t, double preco, string texto, color cor)
{
   if(!MostrarTextos) return;
   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_TEXT, 0, t, preco);
   ObjectSetString(0, nome, OBJPROP_TEXT, texto);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, cor);
   ObjectSetInteger(0, nome, OBJPROP_FONTSIZE, 8);
   ObjectMove(0, nome, 0, t, preco);
}


void CriarLinhaVerticalTamanhoCanal(string nome, datetime t, double precoTopo, double precoFundo)
{
   if(!MostrarTamanhoCanal) return;

   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_TREND, 0, t, precoTopo, t, precoFundo);

   ObjectSetInteger(0, nome, OBJPROP_COLOR, CorTamanhoCanal);
   ObjectSetInteger(0, nome, OBJPROP_WIDTH, EspessuraLinhaTamanhoCanal);
   ObjectSetInteger(0, nome, OBJPROP_STYLE, STYLE_SOLID);
   ObjectSetInteger(0, nome, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_SELECTED, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, 20);

   ObjectMove(0, nome, 0, t, precoTopo);
   ObjectMove(0, nome, 1, t, precoFundo);
}

void CriarTextoTamanhoCanal(string nome, datetime t, double preco, double pontos)
{
   if(!MostrarTamanhoCanal) return;

   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_TEXT, 0, t, preco);

   string texto = DoubleToString(pontos, 0) + " pts";
   ObjectSetString(0, nome, OBJPROP_TEXT, texto);
   ObjectSetString(0, nome, OBJPROP_FONT, "Arial Black");
   ObjectSetInteger(0, nome, OBJPROP_COLOR, CorTamanhoCanal);
   ObjectSetInteger(0, nome, OBJPROP_FONTSIZE, FonteTamanhoCanal);
   ObjectSetInteger(0, nome, OBJPROP_ANCHOR, ANCHOR_CENTER);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_SELECTED, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, 30);

   ObjectMove(0, nome, 0, t, preco);
}

void DesenharTamanhoCanalNoGrafico(string prefixo, datetime base, double hi, double lo)
{
   if(!MostrarTamanhoCanal) return;

   int segundosTF = PeriodSeconds(TimeframePrimeiraBarra);
   if(segundosTF <= 0) segundosTF = 300;

   datetime tMedida = base + segundosTF + (DeslocamentoTextoCanal_Candles * segundosTF);
   double meio = (hi + lo) / 2.0;
   double pontos = MathAbs(hi - lo) / _Point;

   CriarLinhaVerticalTamanhoCanal(prefixo + "MEDIDA_CANAL", tMedida, hi, lo);
   CriarTextoTamanhoCanal(prefixo + "TXT_MEDIDA_CANAL", tMedida, meio, pontos);
}


void ApagarLinhasCestaAtual()
{
   ObjectDelete(0, "PBFX_TP_CESTA_ATUAL");
   ObjectDelete(0, "PBFX_TP_CESTA_TXT");
   ObjectDelete(0, "PBFX_STOP_CESTA_ATUAL");
   ObjectDelete(0, "PBFX_STOP_CESTA_TXT");
}

void CriarLinhaCestaAtual(string nome, double preco, color cor, int estilo, int largura)
{
   if(preco <= 0.0) return;
   datetime t1 = TimeCurrent();
   datetime t2 = FimOperacaoParaDia(diaAtual > 0 ? diaAtual : DiaBaseOperacional(TimeCurrent()));
   if(t2 <= t1) t2 = t1 + PeriodSeconds(TimeframePrimeiraBarra) * 20;

   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_TREND, 0, t1, preco, t2, preco);

   ObjectMove(0, nome, 0, t1, preco);
   ObjectMove(0, nome, 1, t2, preco);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, cor);
   ObjectSetInteger(0, nome, OBJPROP_STYLE, estilo);
   ObjectSetInteger(0, nome, OBJPROP_WIDTH, largura);
   ObjectSetInteger(0, nome, OBJPROP_RAY_RIGHT, true);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, 60);
}

void CriarTextoCestaAtual(string nome, string texto, double preco, color cor)
{
   if(preco <= 0.0) return;
   datetime t = TimeCurrent() + PeriodSeconds(TimeframePrimeiraBarra) * 3;
   double precoTexto = preco;
   double desloc = DistanciaTextoCesta_Pontos * _Point;
   if(StringFind(texto, "TP") >= 0)
      precoTexto = preco + desloc;
   else if(StringFind(texto, "STOP") >= 0)
      precoTexto = preco - desloc;

   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_TEXT, 0, t, precoTexto);

   ObjectMove(0, nome, 0, t, precoTexto);
   ObjectSetString(0, nome, OBJPROP_TEXT, texto);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, cor);
   ObjectSetInteger(0, nome, OBJPROP_FONTSIZE, FonteTextoTPCesta);
   ObjectSetString(0, nome, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, nome, OBJPROP_ANCHOR, ANCHOR_LEFT);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, 70);
}

void DesenharLinhasCestaAtual()
{
   if(!cestaReversaoAtiva)
   {
      ApagarLinhasCestaAtual();
      return;
   }

   if(MostrarLinhaTPCesta && alvoCestaReversao > 0.0 && !trailingCestaAtivo)
   {
      CriarLinhaCestaAtual("PBFX_TP_CESTA_ATUAL", alvoCestaReversao, CorLinhaTPCesta, STYLE_DASHDOT, 2);
      CriarTextoCestaAtual("PBFX_TP_CESTA_TXT", "TP CESTA", alvoCestaReversao, CorTextoTPCesta);
   }
   else
   {
      ObjectDelete(0, "PBFX_TP_CESTA_ATUAL");
      ObjectDelete(0, "PBFX_TP_CESTA_TXT");
   }

   if(MostrarLinhaStopCesta && stopCestaReversao > 0.0 && (UsarStopCestaReversao || beCestaAtivo || trailingCestaAtivo))
   {
      CriarLinhaCestaAtual("PBFX_STOP_CESTA_ATUAL", stopCestaReversao, CorLinhaStopCesta, STYLE_DOT, 1);
      CriarTextoCestaAtual("PBFX_STOP_CESTA_TXT", "STOP CESTA", stopCestaReversao, CorTextoStopCesta);
   }
   else
   {
      ObjectDelete(0, "PBFX_STOP_CESTA_ATUAL");
      ObjectDelete(0, "PBFX_STOP_CESTA_TXT");
   }
}

void CriarNumeroCandle(string nome, datetime t, double preco, int numero)
{
   if(!MostrarNumerosCandles) return;
   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_TEXT, 0, t, preco);
   ObjectSetString(0, nome, OBJPROP_TEXT, IntegerToString(numero));
   ObjectSetInteger(0, nome, OBJPROP_COLOR, CorNumerosCandles);
   ObjectSetInteger(0, nome, OBJPROP_FONTSIZE, TamanhoFonteNumeros);
   ObjectSetInteger(0, nome, OBJPROP_ANCHOR, ANCHOR_CENTER);
   ObjectMove(0, nome, 0, t, preco);
}

void DesenharNumerosCandles(datetime dia)
{
   if(!MostrarNumerosCandles) return;
   datetime base = MontarHorario(dia, HoraPrimeiraBarra, MinutoPrimeiraBarra);
   int shiftBase = iBarShift(_Symbol, TimeframePrimeiraBarra, base, false);
   if(shiftBase < 0) return;
   if(iTime(_Symbol, TimeframePrimeiraBarra, shiftBase) != base) return;

   int total = MathMin(QuantidadeCandlesNumerar, shiftBase + 1);
   for(int n=1; n<=total; n++)
   {
      int shift = shiftBase - (n - 1);
      if(shift < 0) break;
      datetime t = iTime(_Symbol, TimeframePrimeiraBarra, shift);
      if(InicioDoDia(t) != dia) break;
      double h = iHigh(_Symbol, TimeframePrimeiraBarra, shift);
      double l = iLow(_Symbol, TimeframePrimeiraBarra, shift);
      double preco = h + DistanciaNumeroPontos * _Point;
      if(n % 2 == 0) preco = l - DistanciaNumeroPontos * _Point;
      string nome = "PBFX_NUM_" + TimeToString(dia, TIME_DATE) + "_" + IntegerToString(n);
      CriarNumeroCandle(nome, t, preco, n);
   }
}

void DesenharDia(datetime dia)
{
   double hi, lo;
   datetime base;
   if(!CarregarPrimeiraBarra(dia, hi, lo, base)) return;

   datetime fim = FimOperacaoParaDia(dia);
   string prefixo = "PBFX_" + TimeToString(dia, TIME_DATE) + "_";
   double tpPontos = DistanciaTPPorCanal(false, hi, lo);
   double tpCompra = hi + tpPontos * _Point;
   double tpVenda  = lo - tpPontos * _Point;
   // Linhas douradas representam a região de reversão/linha externa conforme o modo atual.
   double tpRevCompra = UsarReversaoPorPercentualDoAlvo ? (lo + DistanciaTPPorCanal(false, hi, lo) * (MathMax(0.0, Reversao_Ativar_Quando_Andar_Contra_Percentual_Do_Alvo)/100.0) * _Point)
                                                        : (hi + DistanciaTPFixo(true) * _Point);
   double tpRevVenda  = UsarReversaoPorPercentualDoAlvo ? (hi - DistanciaTPPorCanal(false, hi, lo) * (MathMax(0.0, Reversao_Ativar_Quando_Andar_Contra_Percentual_Do_Alvo)/100.0) * _Point)
                                                        : (lo - DistanciaTPFixo(true) * _Point);

   CriarLinha(prefixo+"COMPRA", base, fim, hi, CorLinhaCompra, STYLE_SOLID);
   CriarLinha(prefixo+"VENDA",  base, fim, lo, CorLinhaVenda, STYLE_SOLID);
   CriarLinha(prefixo+"MEIO",   base, fim, (hi+lo)/2.0, CorCanal, STYLE_DOT);
   CriarLinha(prefixo+"TP_C",   base, fim, tpCompra, CorLinhaTP, STYLE_DASH);
   CriarLinha(prefixo+"TP_V",   base, fim, tpVenda,  CorLinhaTP, STYLE_DASH);
   CriarLinha(prefixo+"TPR_C",  base, fim, tpRevCompra, CorLinhaTPReversao, STYLE_DOT);
   CriarLinha(prefixo+"TPR_V",  base, fim, tpRevVenda,  CorLinhaTPReversao, STYLE_DOT);

   DesenharTamanhoCanalNoGrafico(prefixo, base, hi, lo);

   CriarTexto(prefixo+"TXT_C", base, hi, "COMPRA", CorLinhaCompra);
   CriarTexto(prefixo+"TXT_V", base, lo, "VENDA", CorLinhaVenda);
   DesenharNumerosCandles(dia);
}

void DesenharHistoricoDias()
{
   if(!DesenharHistorico) return;
   datetime hoje = DiaBaseOperacional(TimeCurrent());
   for(int d=0; d<DiasHistorico; d++)
      DesenharDia(hoje - d * 86400);
}

void TentarCarregarPrimeiraBarraAtual();

void AtualizarDia()
{
   datetime hoje = DiaBaseOperacional(TimeCurrent());
   bool novoDia = (hoje != diaAtual);
   if(!novoDia)
   {
      if(linhaCompra <= 0.0 || linhaVenda <= 0.0)
         TentarCarregarPrimeiraBarraAtual();
      return;
   }

   diaAtual = hoje;
   linhaCompra = 0.0;
   linhaVenda = 0.0;
   barraValida = false;
   estrategiaLiberadaHoje = false;
   reversaoJaUsada = false;
   cestaReversaoAtiva = false;
   alvoCestaReversao = 0.0;
   stopCestaReversao = 0.0;
   precoReferenciaCesta = 0.0;
   beCestaAtivo = false;
   trailingCestaAtivo = false;
   volumeReversaoCalculado = 0.0;
   encerradoHorario = false;
   ladoAtual = LADO_NENHUM;
   ultimoLadoExecutado = LADO_NENHUM;
   ciclosExecutadosHoje = 0;
   statusDia = "Aguardando canal";
   fechandoCesta = false;
   cicloAtualContabilizado = false;
   candleBloqueadoAposFechamento = 0;

   DesenharHistoricoDias();
   TentarCarregarPrimeiraBarraAtual();
}

void TentarCarregarPrimeiraBarraAtual()
{
   datetime hoje = DiaBaseOperacional(TimeCurrent());
   datetime baseEsperada = MontarHorario(hoje, HoraPrimeiraBarra, MinutoPrimeiraBarra);

   // Só carrega depois que a primeira vela do timeframe escolhido já fechou.
   int segundosTF = PeriodSeconds(TimeframePrimeiraBarra);
   if(segundosTF <= 0) segundosTF = 300;
   if(TimeCurrent() < baseEsperada + segundosTF) return;

   double hi, lo;
   datetime base;
   if(CarregarPrimeiraBarra(hoje, hi, lo, base))
   {
      linhaCompra = hi;
      linhaVenda = lo;
      horarioBaseAtual = base;
      barraValida = ValidarTamanhoBarra(hi, lo);
      estrategiaLiberadaHoje = barraValida;
      statusDia = barraValida ? "Estratégia liberada" : "Canal bloqueado pelo filtro";

      // Desenha o canal mesmo que o filtro de tamanho bloqueie as operações, para ficar claro no gráfico.
      DesenharDia(hoje);
   }
}

bool DentroDoHorario()
{
   datetime agora = TimeCurrent();
   datetime dia = DiaBaseOperacional(agora);
   datetime ini = InicioOperacaoParaDia(dia);
   datetime fim = FimOperacaoParaDia(dia);
   return (agora >= ini && agora <= fim);
}


void CancelarPendentesDoRobo()
{
   trade.SetExpertMagicNumber(NumeroMagico);
   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(!OrderSelect(ticket)) continue;
      if(OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
      if((ulong)OrderGetInteger(ORDER_MAGIC) != NumeroMagico) continue;
      trade.OrderDelete(ticket);
   }
}

bool ExistePendenteDoRobo(ENUM_ORDER_TYPE tipo, double preco, double volume, string parteComentario)
{
   double toleranciaPreco = MathMax(_Point * 2.0, SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE) * 2.0);
   double toleranciaVolume = MathMax(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP) / 2.0, 0.0000001);
   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(!OrderSelect(ticket)) continue;
      if(OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
      if((ulong)OrderGetInteger(ORDER_MAGIC) != NumeroMagico) continue;
      if((ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE) != tipo) continue;
      if(MathAbs(OrderGetDouble(ORDER_PRICE_OPEN) - NormalizarPreco(preco)) > toleranciaPreco) continue;
      if(MathAbs(OrderGetDouble(ORDER_VOLUME_CURRENT) - NormalizarVolume(volume)) > toleranciaVolume) continue;
      // Não compara comentário: no MT5 o comentário de ordens pendentes pode ser truncado
      // e isso fazia o EA apagar e recriar a mesma pendente a cada tick.
      return true;
   }
   return false;
}

bool PrecoPendenteValido(ENUM_ORDER_TYPE tipo, double preco)
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   int stops = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = MathMax(stops * _Point, _Point);
   if(tipo == ORDER_TYPE_BUY_STOP)  return (preco > ask + minDist);
   if(tipo == ORDER_TYPE_SELL_STOP) return (preco < bid - minDist);
   return false;
}

bool ColocarBuyStop(double volume, double preco, double sl, double tp, string comentario)
{
   volume = NormalizarVolume(volume);
   preco = NormalizarPreco(preco);
   sl = (sl > 0.0 ? NormalizarPreco(sl) : 0.0);
   tp = (tp > 0.0 ? NormalizarPreco(tp) : 0.0);
   if(!PrecoPendenteValido(ORDER_TYPE_BUY_STOP, preco)) return false;
   if(ExistePendenteDoRobo(ORDER_TYPE_BUY_STOP, preco, volume, comentario)) return true;
   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetDeviationInPoints(SlippagePontos);
   return trade.BuyStop(volume, preco, _Symbol, sl, tp, ORDER_TIME_DAY, 0, comentario);
}

bool ColocarSellStop(double volume, double preco, double sl, double tp, string comentario)
{
   volume = NormalizarVolume(volume);
   preco = NormalizarPreco(preco);
   sl = (sl > 0.0 ? NormalizarPreco(sl) : 0.0);
   tp = (tp > 0.0 ? NormalizarPreco(tp) : 0.0);
   if(!PrecoPendenteValido(ORDER_TYPE_SELL_STOP, preco)) return false;
   if(ExistePendenteDoRobo(ORDER_TYPE_SELL_STOP, preco, volume, comentario)) return true;
   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetDeviationInPoints(SlippagePontos);
   return trade.SellStop(volume, preco, _Symbol, sl, tp, ORDER_TIME_DAY, 0, comentario);
}

bool OrdemPendenteConfere(ulong ticket, ENUM_ORDER_TYPE tipoDesejado, double precoDesejado, double volumeDesejado, string comentarioDesejado)
{
   if(ticket == 0) return false;
   if(!OrderSelect(ticket)) return false;
   if(OrderGetString(ORDER_SYMBOL) != _Symbol) return false;
   if((ulong)OrderGetInteger(ORDER_MAGIC) != NumeroMagico) return false;
   if((ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE) != tipoDesejado) return false;

   double toleranciaPreco = MathMax(_Point * 2.0, SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE) * 2.0);
   double toleranciaVolume = MathMax(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP) / 2.0, 0.0000001);

   if(MathAbs(OrderGetDouble(ORDER_PRICE_OPEN) - NormalizarPreco(precoDesejado)) > toleranciaPreco) return false;
   if(MathAbs(OrderGetDouble(ORDER_VOLUME_CURRENT) - NormalizarVolume(volumeDesejado)) > toleranciaVolume) return false;
   // Não compara comentário: alguns servidores/trades truncam o texto do comentário.
   // A identificação segura aqui é símbolo + magic + tipo + preço + volume.
   return true;
}

void CancelarPendentesQueNaoSao(bool permitirCompra, double precoCompra, double volumeCompra, string comentarioCompra,
                                bool permitirVenda,  double precoVenda,  double volumeVenda,  string comentarioVenda)
{
   trade.SetExpertMagicNumber(NumeroMagico);

   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(!OrderSelect(ticket)) continue;
      if(OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
      if((ulong)OrderGetInteger(ORDER_MAGIC) != NumeroMagico) continue;

      bool manter = false;
      if(permitirCompra && OrdemPendenteConfere(ticket, ORDER_TYPE_BUY_STOP, precoCompra, volumeCompra, comentarioCompra)) manter = true;
      if(permitirVenda  && OrdemPendenteConfere(ticket, ORDER_TYPE_SELL_STOP, precoVenda, volumeVenda, comentarioVenda)) manter = true;

      if(!manter) trade.OrderDelete(ticket);
   }
}

void ArmarPendentesIniciais()
{
   if(!UsarOrdensPendentes) return;

   double tpCompra = NormalizarPreco(linhaCompra + DistanciaTP(false) * _Point);
   double tpVenda  = NormalizarPreco(linhaVenda  - DistanciaTP(false) * _Point);
   double slCompra = CalcularStopOperacaoInicial(LADO_COMPRA);
   double slVenda  = CalcularStopOperacaoInicial(LADO_VENDA);
   double vol = CalcularVolumeInicial();

   bool permitirCompra = (OperarCompras && ultimoLadoExecutado != LADO_COMPRA && FiltroMediaPermite(LADO_COMPRA));
   bool permitirVenda  = (OperarVendas  && ultimoLadoExecutado != LADO_VENDA && FiltroMediaPermite(LADO_VENDA));

   string cCompra = ComentarioOrdens + " PEND COMPRA";
   string cVenda  = ComentarioOrdens + " PEND VENDA";

   // Se o canal acabou de formar e o preço já está além da linha,
   // o Buy Stop/Sell Stop fica para trás e não pode ser armado.
   // Nesse caso, opcionalmente executa a mercado para não perder o rompimento inicial.
   if(JanelaEntradaMercadoInicialAtiva() && !EntradaBloqueadaNesteCandle())
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

      if(permitirCompra && ask >= linhaCompra)
      {
         CancelarPendentesDoRobo();
         reversaoJaUsada = false;
         cestaReversaoAtiva = false;
         alvoCestaReversao = 0.0;
         stopCestaReversao = 0.0;
         if(AbrirCompra(false))
         {
            ciclosExecutadosHoje++;
            cicloAtualContabilizado = true;
            statusDia = "Compra inicial a mercado";
         }
         return;
      }

      if(permitirVenda && bid <= linhaVenda)
      {
         CancelarPendentesDoRobo();
         reversaoJaUsada = false;
         cestaReversaoAtiva = false;
         alvoCestaReversao = 0.0;
         stopCestaReversao = 0.0;
         if(AbrirVenda(false))
         {
            ciclosExecutadosHoje++;
            cicloAtualContabilizado = true;
            statusDia = "Venda inicial a mercado";
         }
         return;
      }
   }

   // Corrige o erro do backtest: não cancelar e recriar a mesma pendente a cada tick.
   // Cancela apenas ordens erradas/antigas e mantém a pendente fixa na linha do canal.
   CancelarPendentesQueNaoSao(permitirCompra, linhaCompra, vol, cCompra,
                              permitirVenda,  linhaVenda,  vol, cVenda);

   if(permitirCompra && !ExistePendenteDoRobo(ORDER_TYPE_BUY_STOP, linhaCompra, vol, cCompra))
      ColocarBuyStop(vol, linhaCompra, slCompra, tpCompra, cCompra);

   if(permitirVenda && !ExistePendenteDoRobo(ORDER_TYPE_SELL_STOP, linhaVenda, vol, cVenda))
      ColocarSellStop(vol, linhaVenda, slVenda, tpVenda, cVenda);
}

void ArmarPendenteReversao(double volCompra, double volVenda)
{
   if(!UsarReversao) return;
   if(!UsarOrdensPendentes) return;
   if(cestaReversaoAtiva || reversaoJaUsada) return;
   if(!CanalPermiteReversao()) return;

   double volOriginal = MathAbs(volCompra - volVenda);
   if(volOriginal <= 0.0) return;
   double volReversao = CalcularVolumeReversao(volOriginal);
   if(volReversao <= 0.0) return;

   string cRevCompra = ComentarioOrdens + " PEND REV COMPRA";
   string cRevVenda  = ComentarioOrdens + " PEND REV VENDA";
   double precoRevVenda  = PrecoReversaoParaVenda();
   double precoRevCompra = PrecoReversaoParaCompra();

   // Se está comprado, mantém fixa apenas a SELL STOP de reversão.
   if(volCompra > volVenda && OperarVendas && FiltroMediaPermite(LADO_VENDA))
   {
      CancelarPendentesQueNaoSao(false, 0.0, 0.0, "",
                                 true, precoRevVenda, volReversao, cRevVenda);
      if(!ExistePendenteDoRobo(ORDER_TYPE_SELL_STOP, precoRevVenda, volReversao, cRevVenda))
         ColocarSellStop(volReversao, precoRevVenda, 0.0, 0.0, cRevVenda);
   }
   // Se está vendido, mantém fixa apenas a BUY STOP de reversão.
   else if(volVenda > volCompra && OperarCompras && FiltroMediaPermite(LADO_COMPRA))
   {
      CancelarPendentesQueNaoSao(true, precoRevCompra, volReversao, cRevCompra,
                                 false, 0.0, 0.0, "");
      if(!ExistePendenteDoRobo(ORDER_TYPE_BUY_STOP, precoRevCompra, volReversao, cRevCompra))
         ColocarBuyStop(volReversao, precoRevCompra, 0.0, 0.0, cRevCompra);
   }
}

void AtivarControleCestaReversao(LadoOperacao ladoLiquido)
{
   reversaoJaUsada = true;
   cestaReversaoAtiva = true;
   CancelarPendentesDoRobo();
   RemoverTPDasCestasAbertas();

   // Quando a reversão proporcional ao alvo está ativa, o TP da cesta deve nascer
   // a partir do preço real/médio da perna de reversão, não mais da linha azul original.
   // Isso evita que a cesta precise andar o restante do canal + o alvo antigo.
   double volCompraAtual, volVendaAtual, pmCompraAtual, pmVendaAtual;
   ObterCestaDoRobo(volCompraAtual, volVendaAtual, pmCompraAtual, pmVendaAtual);

   if(ladoLiquido == LADO_COMPRA)
   {
      ladoAtual = LADO_COMPRA;
      ultimoLadoExecutado = LADO_COMPRA;

      double precoBaseCompra = PrecoReversaoParaCompra();
      if(UsarReversaoPorPercentualDoAlvo && pmCompraAtual > 0.0)
         precoBaseCompra = pmCompraAtual;

      alvoCestaReversao = NormalizarPreco(precoBaseCompra + DistanciaTP(false) * _Point);
      precoReferenciaCesta = precoBaseCompra;
      beCestaAtivo = false;
      trailingCestaAtivo = false;
      stopCestaReversao = CalcularStopCestaReversao(LADO_COMPRA);
      statusDia = "Reversão para COMPRA ativa";
      DesenharLinhasCestaAtual();
   }
   else if(ladoLiquido == LADO_VENDA)
   {
      ladoAtual = LADO_VENDA;
      ultimoLadoExecutado = LADO_VENDA;

      double precoBaseVenda = PrecoReversaoParaVenda();
      if(UsarReversaoPorPercentualDoAlvo && pmVendaAtual > 0.0)
         precoBaseVenda = pmVendaAtual;

      alvoCestaReversao = NormalizarPreco(precoBaseVenda - DistanciaTP(false) * _Point);
      precoReferenciaCesta = precoBaseVenda;
      beCestaAtivo = false;
      trailingCestaAtivo = false;
      stopCestaReversao = CalcularStopCestaReversao(LADO_VENDA);
      statusDia = "Reversão para VENDA ativa";
      DesenharLinhasCestaAtual();
   }
}

void DetectarEntradaOuReversaoPorPendente(double volCompra, double volVenda)
{
   // Primeiro disparo do dia/ciclo: conta operação. A reversão NÃO conta outro ciclo.
   if(!cicloAtualContabilizado && (volCompra > 0.0 || volVenda > 0.0))
   {
      ciclosExecutadosHoje++;
      cicloAtualContabilizado = true;
      if(volCompra > volVenda) { ladoAtual = LADO_COMPRA; ultimoLadoExecutado = LADO_COMPRA; statusDia = "Compra inicial ativa"; }
      else if(volVenda > volCompra) { ladoAtual = LADO_VENDA; ultimoLadoExecutado = LADO_VENDA; statusDia = "Venda inicial ativa"; }
   }

   if(!UsarReversao) return;
   if(cestaReversaoAtiva || reversaoJaUsada) return;

   // Conta HEDGE: existem as duas pontas depois que a pendente de reversão aciona.
   if(volCompra > 0.0 && volVenda > 0.0)
   {
      if(volCompra > volVenda) AtivarControleCestaReversao(LADO_COMPRA);
      else if(volVenda > volCompra) AtivarControleCestaReversao(LADO_VENDA);
      return;
   }

   // Conta NETTING: o MT5 transforma compra+venda em uma posição líquida.
   // Então detectamos a reversão pela troca do lado líquido depois da primeira entrada.
   if(cicloAtualContabilizado && ladoAtual == LADO_COMPRA && volVenda > volCompra)
   {
      AtivarControleCestaReversao(LADO_VENDA);
      return;
   }
   if(cicloAtualContabilizado && ladoAtual == LADO_VENDA && volCompra > volVenda)
   {
      AtivarControleCestaReversao(LADO_COMPRA);
      return;
   }
}

// FIX3: Remove o TP embutido de todas as posições do robô.
// Necessário ao entrar em reversão: sem isso, o TP da posição inicial continua ativo
// na corretora e pode fechar só ela, deixando a outra perna da cesta órfã.
void RemoverTPDasCestasAbertas()
{
   trade.SetExpertMagicNumber(NumeroMagico);
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != NumeroMagico) continue;
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      if(tp != 0.0)
         trade.PositionModify(ticket, sl, 0.0);  // zera só o TP, mantém SL se houver
   }
}

bool AbrirCompra(bool reversao)
{
   double vol = NormalizarVolume(reversao ? (volumeReversaoCalculado > 0.0 ? volumeReversaoCalculado : CalcularVolumeReversao(CalcularVolumeInicial())) : CalcularVolumeInicial());
   double tp = reversao ? 0.0 : NormalizarPreco(SymbolInfoDouble(_Symbol, SYMBOL_ASK) + DistanciaTP(false) * _Point);
   double sl = reversao ? 0.0 : CalcularStopOperacaoInicial(LADO_COMPRA);
   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetDeviationInPoints(SlippagePontos);
   bool ok = trade.Buy(vol, _Symbol, 0.0, sl, tp, ComentarioOrdens + (reversao ? " REV COMPRA" : " COMPRA"));
   if(ok) { ladoAtual = LADO_COMPRA; ultimoLadoExecutado = LADO_COMPRA; }
   return ok;
}

bool AbrirVenda(bool reversao)
{
   double vol = NormalizarVolume(reversao ? (volumeReversaoCalculado > 0.0 ? volumeReversaoCalculado : CalcularVolumeReversao(CalcularVolumeInicial())) : CalcularVolumeInicial());
   double tp = reversao ? 0.0 : NormalizarPreco(SymbolInfoDouble(_Symbol, SYMBOL_BID) - DistanciaTP(false) * _Point);
   double sl = reversao ? 0.0 : CalcularStopOperacaoInicial(LADO_VENDA);
   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetDeviationInPoints(SlippagePontos);
   bool ok = trade.Sell(vol, _Symbol, 0.0, sl, tp, ComentarioOrdens + (reversao ? " REV VENDA" : " VENDA"));
   if(ok) { ladoAtual = LADO_VENDA; ultimoLadoExecutado = LADO_VENDA; }
   return ok;
}

void VerificarFechamentoPorTPManual()
{
   double vc, vv, pmc, pmv;
   if(ObterCestaDoRobo(vc, vv, pmc, pmv)) return;
   ladoAtual = LADO_NENHUM;
   cestaReversaoAtiva = false;
   reversaoJaUsada = false;
   alvoCestaReversao = 0.0;
   stopCestaReversao = 0.0;
   precoReferenciaCesta = 0.0;
   beCestaAtivo = false;
   trailingCestaAtivo = false;
   ApagarLinhasCestaAtual();
}




bool SLOrdemUnicaValido(ENUM_POSITION_TYPE tipo, double novoSL)
{
   if(novoSL <= 0.0) return false;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   int stops  = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   int freeze = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minDist = MathMax(MathMax(stops, freeze) * _Point, _Point);

   if(tipo == POSITION_TYPE_BUY)
      return (novoSL < bid - minDist);

   if(tipo == POSITION_TYPE_SELL)
      return (novoSL > ask + minDist);

   return false;
}


bool ExisteUmaPosicaoDoRobo(ulong &ticketUnico, ENUM_POSITION_TYPE &tipoUnico, double &entradaUnica, double &slUnico, double &tpUnico)
{
   int qtd = 0;
   ticketUnico = 0;
   entradaUnica = 0.0;
   slUnico = 0.0;
   tpUnico = 0.0;

   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != NumeroMagico) continue;

      qtd++;
      ticketUnico = ticket;
      tipoUnico = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      entradaUnica = PositionGetDouble(POSITION_PRICE_OPEN);
      slUnico = PositionGetDouble(POSITION_SL);
      tpUnico = PositionGetDouble(POSITION_TP);
   }

   return (qtd == 1 && ticketUnico > 0);
}

bool TrailingOrdemUnicaJaDeveAssumir(ENUM_POSITION_TYPE tipo, double entrada)
{
   if(!Ativar_Trailing_Ordem_Unica) return false;

   double alvoPontos = DistanciaTP(false);
   if(alvoPontos <= 0.0 || entrada <= 0.0) return false;

   double ativaPontos = alvoPontos * (Trailing_Ordem_Unica_Ativar_Quando_Atingir_Percentual_Do_Alvo / 100.0);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   if(tipo == POSITION_TYPE_BUY)
      return ((bid - entrada) / _Point >= ativaPontos);
   if(tipo == POSITION_TYPE_SELL)
      return ((entrada - ask) / _Point >= ativaPontos);

   return false;
}

void GarantirTPRealDasOperacoes()
{
   if(fechandoCesta) return;

   ulong ticket;
   ENUM_POSITION_TYPE tipo;
   double entrada, sl, tp;
   if(!ExisteUmaPosicaoDoRobo(ticket, tipo, entrada, sl, tp)) return;

   double tpDesejado = 0.0;

   // Ordem única: mantém TP físico enquanto o trailing ainda não assumiu.
   if(!cestaReversaoAtiva && GarantirTPRealOrdemUnica)
   {
      if(TrailingOrdemUnicaJaDeveAssumir(tipo, entrada))
         return;

      if(tipo == POSITION_TYPE_BUY)
         tpDesejado = NormalizarPreco(entrada + DistanciaTP(false) * _Point);
      else if(tipo == POSITION_TYPE_SELL)
         tpDesejado = NormalizarPreco(entrada - DistanciaTP(false) * _Point);
   }

   // Cesta em conta NETTING ou situação com uma posição só: dá para colocar TP físico.
   // Em conta HEDGE com duas pontas abertas, TP físico individual não representa TP da cesta.
   if(cestaReversaoAtiva && GarantirTPRealCestaQuandoPossivel && !trailingCestaAtivo && alvoCestaReversao > 0.0)
      tpDesejado = NormalizarPreco(alvoCestaReversao);

   if(tpDesejado <= 0.0) return;
   if(tp > 0.0 && MathAbs(tp - tpDesejado) <= _Point * 0.5) return;

   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetDeviationInPoints(SlippagePontos);
   ResetLastError();
   if(!trade.PositionModify(ticket, sl, tpDesejado))
   {
      Print("Rompedor Flow: falha ao garantir TP real. Ticket=", ticket,
            " TP=", DoubleToString(tpDesejado,_Digits),
            " Retcode=", trade.ResultRetcode(),
            " Desc=", trade.ResultRetcodeDescription(),
            " Erro=", GetLastError());
   }
}

void PlotarResultadoOperacaoPendente()
{
   if(!PlotarResultadoOperacaoNoGrafico) return;
   if(horarioPlotResultado <= 0) return;
   if(TimeCurrent() < horarioPlotResultado) return;

   double vc, vv, pmc, pmv;
   if(ObterCestaDoRobo(vc, vv, pmc, pmv)) return; // espera a cesta/ordem realmente zerar

   if(MathAbs(resultadoOperacaoPendente) < 0.0000001)
   {
      horarioPlotResultado = 0;
      return;
   }

   contadorResultadosPlotados++;
   string nome = "PBFX_RESULTADO_OP_" + IntegerToString(contadorResultadosPlotados);
   datetime t = (horarioUltimoFechamentoOperacao > 0 ? horarioUltimoFechamentoOperacao : TimeCurrent());
   double preco = (precoUltimoFechamentoOperacao > 0.0 ? precoUltimoFechamentoOperacao : SymbolInfoDouble(_Symbol, SYMBOL_BID));

   double deslocamento = MathMax(DistanciaResultadoDoPreco_Pontos, 1.0) * _Point;
   if(resultadoOperacaoPendente >= 0.0)
      preco += deslocamento;
   else
      preco -= deslocamento;

   string texto = (resultadoOperacaoPendente >= 0.0 ? "+" : "") + DoubleToString(resultadoOperacaoPendente, 2);

   ObjectCreate(0, nome, OBJ_TEXT, 0, t, NormalizarPreco(preco));
   ObjectSetString(0, nome, OBJPROP_TEXT, texto);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, (resultadoOperacaoPendente >= 0.0 ? CorResultadoPositivo : CorResultadoNegativo));
   ObjectSetInteger(0, nome, OBJPROP_FONTSIZE, FonteResultadoOperacao);
   ObjectSetString(0, nome, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, nome, OBJPROP_ANCHOR, ANCHOR_CENTER);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, 120);

   resultadoOperacaoPendente = 0.0;
   horarioPlotResultado = 0;
   horarioUltimoFechamentoOperacao = 0;
   precoUltimoFechamentoOperacao = 0.0;
}

void GerenciarProtecaoOrdemUnica()
{
   if(fechandoCesta) return;
   if(cestaReversaoAtiva) return;
   if(!Ativar_BreakEven_Ordem_Unica && !Ativar_Trailing_Ordem_Unica) return;

   double vc, vv, pmc, pmv;
   if(!ObterCestaDoRobo(vc, vv, pmc, pmv)) return;

   // Ordem única = somente um lado aberto. Se houver compra e venda, é cesta/reversão.
   if(vc > 0.0 && vv > 0.0) return;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != NumeroMagico) continue;

      ENUM_POSITION_TYPE tipo = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double entrada = PositionGetDouble(POSITION_PRICE_OPEN);
      double slAtual = PositionGetDouble(POSITION_SL);
      double tpAtual = PositionGetDouble(POSITION_TP);
      if(entrada <= 0.0) continue;

      // Usa o alvo CONFIGURADO da operação como referência percentual.
      // Antes usava a distância entre entrada e TP real; em pendente, por causa de slippage,
      // isso podia alterar a referência e fazer o trailing acionar fora do ponto esperado.
      double alvoPontos = DistanciaTP(false);
      if(alvoPontos <= 0.0 && tpAtual > 0.0)
         alvoPontos = MathAbs(tpAtual - entrada) / _Point;
      if(alvoPontos <= 0.0) continue;

      double beAtivarPontos       = alvoPontos * (BreakEven_Ordem_Unica_Ativar_Quando_Atingir_Percentual_Do_Alvo / 100.0);
      double beProtegerPontos     = alvoPontos * (BreakEven_Ordem_Unica_Proteger_Em_Percentual_Do_Alvo / 100.0);
      double trailAtivarPontos    = alvoPontos * (Trailing_Ordem_Unica_Ativar_Quando_Atingir_Percentual_Do_Alvo / 100.0);
      double trailDistanciaPontos = alvoPontos * (Trailing_Ordem_Unica_Manter_Distancia_Percentual_Do_Alvo / 100.0);
      double trailPassoPontos     = alvoPontos * (Trailing_Ordem_Unica_Atualizar_A_Cada_Percentual_Do_Alvo / 100.0);

      if(trailDistanciaPontos < 1.0) trailDistanciaPontos = 1.0;
      if(trailPassoPontos < 1.0)     trailPassoPontos = 1.0;

      double novoSL = slAtual;
      bool trailingOrdemUnicaAcionado = false;

      if(tipo == POSITION_TYPE_BUY)
      {
         double pontosFavor = (bid - entrada) / _Point;

         if(Ativar_BreakEven_Ordem_Unica && pontosFavor >= beAtivarPontos)
         {
            double beSL = NormalizarPreco(entrada + beProtegerPontos * _Point);
            if(novoSL <= 0.0 || beSL > novoSL)
               novoSL = beSL;
         }

         if(Ativar_Trailing_Ordem_Unica && pontosFavor >= trailAtivarPontos)
         {
            trailingOrdemUnicaAcionado = true;
            double trailSL = NormalizarPreco(bid - trailDistanciaPontos * _Point);
            if(novoSL <= 0.0 || trailSL >= novoSL + trailPassoPontos * _Point)
               novoSL = trailSL;
         }

         if(novoSL > 0.0 && (slAtual <= 0.0 || novoSL > slAtual + _Point * 0.5))
         {
            novoSL = NormalizarPreco(novoSL);
            if(!SLOrdemUnicaValido(tipo, novoSL)) continue;

            trade.SetExpertMagicNumber(NumeroMagico);
            trade.SetDeviationInPoints(SlippagePontos);
            ResetLastError();
            if(trade.PositionModify(ticket, novoSL, (trailingOrdemUnicaAcionado ? 0.0 : tpAtual)))
               statusDia = (trailingOrdemUnicaAcionado ? "Trailing ordem única ativo - TP removido" : "Proteção ordem única ativa");
            else
               Print("Rompedor Flow: falha ao modificar SL da COMPRA. Ticket=", ticket,
                     " SL=", DoubleToString(novoSL,_Digits),
                     " Retcode=", trade.ResultRetcode(),
                     " Desc=", trade.ResultRetcodeDescription(),
                     " Erro=", GetLastError());
         }
      }
      else if(tipo == POSITION_TYPE_SELL)
      {
         double pontosFavor = (entrada - ask) / _Point;

         if(Ativar_BreakEven_Ordem_Unica && pontosFavor >= beAtivarPontos)
         {
            double beSL = NormalizarPreco(entrada - beProtegerPontos * _Point);
            if(novoSL <= 0.0 || beSL < novoSL)
               novoSL = beSL;
         }

         if(Ativar_Trailing_Ordem_Unica && pontosFavor >= trailAtivarPontos)
         {
            trailingOrdemUnicaAcionado = true;
            double trailSL = NormalizarPreco(ask + trailDistanciaPontos * _Point);
            if(novoSL <= 0.0 || trailSL <= novoSL - trailPassoPontos * _Point)
               novoSL = trailSL;
         }

         if(novoSL > 0.0 && (slAtual <= 0.0 || novoSL < slAtual - _Point * 0.5))
         {
            novoSL = NormalizarPreco(novoSL);
            if(!SLOrdemUnicaValido(tipo, novoSL)) continue;

            trade.SetExpertMagicNumber(NumeroMagico);
            trade.SetDeviationInPoints(SlippagePontos);
            ResetLastError();
            if(trade.PositionModify(ticket, novoSL, (trailingOrdemUnicaAcionado ? 0.0 : tpAtual)))
               statusDia = (trailingOrdemUnicaAcionado ? "Trailing ordem única ativo - TP removido" : "Proteção ordem única ativa");
            else
               Print("Rompedor Flow: falha ao modificar SL da VENDA. Ticket=", ticket,
                     " SL=", DoubleToString(novoSL,_Digits),
                     " Retcode=", trade.ResultRetcode(),
                     " Desc=", trade.ResultRetcodeDescription(),
                     " Erro=", GetLastError());
         }
      }
   }
}

string StatusProtecaoCesta()
{
   if(!cestaReversaoAtiva) return "---";
   string s = "";
   if(Ativar_BreakEven_Cesta)
      s += (beCestaAtivo ? "BE ON" : "BE OFF");
   if(Ativar_Trailing_Cesta)
   {
      if(StringLen(s) > 0) s += " | ";
      s += (trailingCestaAtivo ? "TRAIL ON" : "TRAIL OFF");
   }
   if(StringLen(s) == 0) s = "Sem proteção";
   return s;
}

void GerenciarProtecaoCestaReversao()
{
   if(fechandoCesta) return;
   if(!cestaReversaoAtiva) return;
   if(!Ativar_BreakEven_Cesta && !Ativar_Trailing_Cesta) return;
   if(precoReferenciaCesta <= 0.0) return;
   if(alvoCestaReversao <= 0.0) return;

   double alvoTotalPontos = MathAbs(alvoCestaReversao - precoReferenciaCesta) / _Point;
   if(alvoTotalPontos <= 0.0) return;

   double beAtivarPontos       = alvoTotalPontos * (BreakEven_Ativar_Quando_Atingir_Percentual_Do_Alvo / 100.0);
   double beProtegerPontos     = alvoTotalPontos * (BreakEven_Proteger_Em_Percentual_Do_Alvo / 100.0);
   double trailAtivarPontos    = alvoTotalPontos * (Trailing_Ativar_Quando_Atingir_Percentual_Do_Alvo / 100.0);
   double trailDistanciaPontos = alvoTotalPontos * (Trailing_Manter_Distancia_Percentual_Do_Alvo / 100.0);
   double trailPassoPontos     = alvoTotalPontos * (Trailing_Atualizar_A_Cada_Percentual_Do_Alvo / 100.0);

   if(trailPassoPontos < 1.0)
      trailPassoPontos = 1.0;

   double vc, vv, pmc, pmv;
   if(!ObterCestaDoRobo(vc, vv, pmc, pmv)) return;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double novoStop = stopCestaReversao;

   if(vc > vv)
   {
      // Cesta líquida comprada: lucro realizado pelo BID.
      double pontosFavor = (bid - precoReferenciaCesta) / _Point;

      if(Ativar_BreakEven_Cesta && !beCestaAtivo && pontosFavor >= beAtivarPontos)
      {
         double beStop = NormalizarPreco(precoReferenciaCesta + beProtegerPontos * _Point);
         if(novoStop <= 0.0 || beStop > novoStop)
            novoStop = beStop;
         beCestaAtivo = true;
         statusDia = "BE da cesta ativo";
      }

      if(Ativar_Trailing_Cesta && pontosFavor >= trailAtivarPontos)
      {
         double trailStop = NormalizarPreco(bid - trailDistanciaPontos * _Point);
         if(novoStop <= 0.0 || trailStop > novoStop + trailPassoPontos * _Point)
         {
            novoStop = trailStop;
            trailingCestaAtivo = true;
            statusDia = "Trailing da cesta ativo";
         }
      }
   }
   else if(vv > vc)
   {
      // Cesta líquida vendida: lucro realizado pelo ASK.
      double pontosFavor = (precoReferenciaCesta - ask) / _Point;

      if(Ativar_BreakEven_Cesta && !beCestaAtivo && pontosFavor >= beAtivarPontos)
      {
         double beStop = NormalizarPreco(precoReferenciaCesta - beProtegerPontos * _Point);
         if(novoStop <= 0.0 || beStop < novoStop)
            novoStop = beStop;
         beCestaAtivo = true;
         statusDia = "BE da cesta ativo";
      }

      if(Ativar_Trailing_Cesta && pontosFavor >= trailAtivarPontos)
      {
         double trailStop = NormalizarPreco(ask + trailDistanciaPontos * _Point);
         if(novoStop <= 0.0 || trailStop < novoStop - trailPassoPontos * _Point)
         {
            novoStop = trailStop;
            trailingCestaAtivo = true;
            statusDia = "Trailing da cesta ativo";
         }
      }
   }

   if(novoStop > 0.0 && MathAbs(novoStop - stopCestaReversao) >= (_Point * 0.5))
   {
      stopCestaReversao = NormalizarPreco(novoStop);
      DesenharLinhasCestaAtual();
   }
}


void VerificarAlvoCestaReversao()
{
   if(fechandoCesta) return;
   if(cestaReversaoAtiva) DesenharLinhasCestaAtual();
   if(!cestaReversaoAtiva || alvoCestaReversao <= 0.0) return;

   double vc, vv, pmc, pmv;
   if(!ObterCestaDoRobo(vc, vv, pmc, pmv))
   {
      cestaReversaoAtiva = false;
      alvoCestaReversao = 0.0;
      stopCestaReversao = 0.0;
      precoReferenciaCesta = 0.0;
      beCestaAtivo = false;
      trailingCestaAtivo = false;
      reversaoJaUsada = false;
      ApagarLinhasCestaAtual();
      return;
   }

   if(trailingCestaAtivo)
   {
      // Quando o trailing da cesta ativa, o TP manual deixa de fechar a cesta.
      // O gerenciamento passa a ser feito pelo stop virtual da cesta.
      DesenharLinhasCestaAtual();
      return;
   }

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   // Cesta líquida comprada: alvo está acima — usa bid para verificar chegada.
   if(vc > vv && bid >= alvoCestaReversao)
   {
      FecharPosicaoDoRobo();
      cestaReversaoAtiva = false;
      alvoCestaReversao = 0.0;
      stopCestaReversao = 0.0;
      precoReferenciaCesta = 0.0;
      beCestaAtivo = false;
      trailingCestaAtivo = false;
      ladoAtual = LADO_NENHUM;
      reversaoJaUsada = false;
      ApagarLinhasCestaAtual();
      statusDia = "Cesta fechada no TP";
   }
   // FIX4: cesta líquida vendida: alvo está abaixo — usa bid (não ask) para verificar chegada.
   // O ask é sempre maior que bid; usar ask aqui fazia o alvo nunca ser atingido corretamente.
   else if(vv > vc && bid <= alvoCestaReversao)
   {
      FecharPosicaoDoRobo();
      cestaReversaoAtiva = false;
      alvoCestaReversao = 0.0;
      stopCestaReversao = 0.0;
      precoReferenciaCesta = 0.0;
      beCestaAtivo = false;
      trailingCestaAtivo = false;
      ladoAtual = LADO_NENHUM;
      reversaoJaUsada = false;
      ApagarLinhasCestaAtual();
      statusDia = "Cesta fechada no TP";
   }
}

void VerificarStopCestaReversao()
{
   if(fechandoCesta) return;
   if(cestaReversaoAtiva) DesenharLinhasCestaAtual();
   if(!UsarStopCestaReversao || !cestaReversaoAtiva || stopCestaReversao <= 0.0) return;

   double vc, vv, pmc, pmv;
   if(!ObterCestaDoRobo(vc, vv, pmc, pmv))
   {
      cestaReversaoAtiva = false;
      alvoCestaReversao = 0.0;
      stopCestaReversao = 0.0;
      precoReferenciaCesta = 0.0;
      beCestaAtivo = false;
      trailingCestaAtivo = false;
      reversaoJaUsada = false;
      ApagarLinhasCestaAtual();
      return;
   }

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   // Cesta líquida comprada: stop está abaixo — usa bid para verificar rompimento.
   if(vc > vv && bid <= stopCestaReversao)
   {
      FecharPosicaoDoRobo();
      cestaReversaoAtiva = false;
      alvoCestaReversao = 0.0;
      stopCestaReversao = 0.0;
      precoReferenciaCesta = 0.0;
      beCestaAtivo = false;
      trailingCestaAtivo = false;
      ladoAtual = LADO_NENHUM;
      reversaoJaUsada = false;
      ApagarLinhasCestaAtual();
      statusDia = "Cesta fechada no STOP";
   }
   // Cesta líquida vendida: stop está acima — usa ask para verificar rompimento.
   else if(vv > vc && ask >= stopCestaReversao)
   {
      FecharPosicaoDoRobo();
      cestaReversaoAtiva = false;
      alvoCestaReversao = 0.0;
      stopCestaReversao = 0.0;
      precoReferenciaCesta = 0.0;
      beCestaAtivo = false;
      trailingCestaAtivo = false;
      ladoAtual = LADO_NENHUM;
      reversaoJaUsada = false;
      ApagarLinhasCestaAtual();
      statusDia = "Cesta fechada no STOP";
   }
}

string ValorColorido(double valor)
{
   return DoubleToString(valor, 2);
}

color CorValorFinanceiro(double valor)
{
   if(valor > 0.0) return clrLime;
   if(valor < 0.0) return clrTomato;
   return clrSilver;
}

void PainelRetangulo(string nome, int x, int y, int w, int h, color borda, color fundo)
{
   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, nome, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, nome, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, nome, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, nome, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, nome, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, borda);
   ObjectSetInteger(0, nome, OBJPROP_BGCOLOR, fundo);
   ObjectSetInteger(0, nome, OBJPROP_STYLE, STYLE_SOLID);
   ObjectSetInteger(0, nome, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, PAINEL_ZFUNDO);
}

void PainelTexto(string nome, int x, int y, string texto, color cor, int fonte=8, string font="Arial")
{
   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, nome, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, nome, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, nome, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, nome, OBJPROP_TEXT, texto);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, cor);
   ObjectSetInteger(0, nome, OBJPROP_FONTSIZE, fonte);
   ObjectSetString(0, nome, OBJPROP_FONT, font);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, PAINEL_ZTEXTO);
}

void PainelTextoCentro(string nome, int xCentro, int y, string texto, color cor, int fonte=8, string font="Arial")
{
   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, nome, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, nome, OBJPROP_XDISTANCE, xCentro);
   ObjectSetInteger(0, nome, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, nome, OBJPROP_ANCHOR, ANCHOR_CENTER);
   ObjectSetString(0, nome, OBJPROP_TEXT, texto);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, cor);
   ObjectSetInteger(0, nome, OBJPROP_FONTSIZE, fonte);
   ObjectSetString(0, nome, OBJPROP_FONT, font);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, PAINEL_ZTEXTO);
}

void PainelLinhaInfo(string prefixo, int &idx, int x, int y, string rotulo, string valor, color corValor=clrWhite)
{
   int yy = y + idx * 15;
   PainelTexto(prefixo + "_L" + IntegerToString(idx), x, yy, rotulo, clrWhite, PainelFonteBase, "Arial");
   PainelTexto(prefixo + "_V" + IntegerToString(idx), x + 200, yy, valor, corValor, PainelFonteBase, "Arial");
   idx++;
}

void PainelCabecalho(string nome, int x, int y, string texto)
{
   PainelTexto(nome, x, y, texto, clrGold, PainelFonteBase+1, "Arial Bold");
}

string SimNao(bool v)
{
   return (v ? "SIM" : "NÃO");
}

string AtivoDesativo(bool v)
{
   return (v ? "ATIVADO" : "DESATIVADO");
}


void PainelBotaoCheck(string nome, int x, int y, string texto, bool ligado)
{
   // Botao real do MT5: evita aqueles quadrados soltos ficando em cima das palavras.
   // Visual premium: dourado quando ligado, escuro quando desligado.
   if(ObjectFind(0, nome) < 0)
      ObjectCreate(0, nome, OBJ_BUTTON, 0, 0, 0);

   int bw = 78;
   if(texto == "Semana") bw = 96;
   if(texto == "Total")  bw = 84;

   string t = (ligado ? "✓ " : "□ ") + texto;
   ObjectSetInteger(0, nome, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, nome, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, nome, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, nome, OBJPROP_XSIZE, bw);
   ObjectSetInteger(0, nome, OBJPROP_YSIZE, 24);
   ObjectSetString(0, nome, OBJPROP_TEXT, t);
   ObjectSetString(0, nome, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, nome, OBJPROP_FONTSIZE, PainelFonteBase+1);
   ObjectSetInteger(0, nome, OBJPROP_COLOR, ligado ? clrBlack : clrWhite);
   ObjectSetInteger(0, nome, OBJPROP_BGCOLOR, ligado ? clrGold : (color)0x202020);
   ObjectSetInteger(0, nome, OBJPROP_BORDER_COLOR, ligado ? clrGold : (color)0x707070);
   ObjectSetInteger(0, nome, OBJPROP_BACK, false);
   ObjectSetInteger(0, nome, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, nome, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nome, OBJPROP_STATE, false);
   ObjectSetInteger(0, nome, OBJPROP_ZORDER, PAINEL_ZTEXTO+5);

   // Remove caixas antigas caso tenham ficado no gráfico de versões anteriores.
   ObjectDelete(0, nome + "_BOX");
}

void LimparLinhasPainel(string prefixo, int maxLinhas)
{
   for(int n=0; n<maxLinhas; n++)
   {
      ObjectDelete(0, prefixo + "_L" + IntegerToString(n));
      ObjectDelete(0, prefixo + "_V" + IntegerToString(n));
   }
}

void AtualizarPainel()
{
   if(!MostrarPainel) return;

   // Limpa restos de versões anteriores apenas uma vez, para não piscar o painel a cada tick.
   if(!painelLimpezaInicialFeita)
   {
      ObjectDelete(0, "PBFX_PAINEL_STATUS");
      ObjectDelete(0, "PBFX_PANEL_BOX_INFO");
      ObjectDelete(0, "PBFX_PANEL_H_INFO");
      ObjectDelete(0, "PBFX_PANEL_BOX_FILTROS");
      ObjectDelete(0, "PBFX_PANEL_H_FILTROS");
      ObjectDelete(0, "PBFX_TOGGLE_DIA_BOX");
      ObjectDelete(0, "PBFX_TOGGLE_SEMANA_BOX");
      ObjectDelete(0, "PBFX_TOGGLE_MES_BOX");
      ObjectDelete(0, "PBFX_TOGGLE_TOTAL_BOX");
      LimparLinhasPainel("PBFX_FILTROS", 8);
      for(int delInfo=0; delInfo<8; delInfo++)
      {
         ObjectDelete(0, "PBFX_INFO_L" + IntegerToString(delInfo));
         ObjectDelete(0, "PBFX_INFO_V" + IntegerToString(delInfo));
      }
      painelLimpezaInicialFeita = true;
   }

   double vc=0.0, vv=0.0, pmc=0.0, pmv=0.0;
   ObterCestaDoRobo(vc, vv, pmc, pmv);

   string ladoLiberado = "Ambos";
   if(ultimoLadoExecutado == LADO_COMPRA) ladoLiberado = "Venda";
   else if(ultimoLadoExecutado == LADO_VENDA) ladoLiberado = "Compra";

   string direcao = "---";
   if(ladoAtual == LADO_COMPRA) direcao = "COMPRA";
   else if(ladoAtual == LADO_VENDA) direcao = "VENDA";

   string statusPainel = statusDia;
   if(StringLen(statusPainel) > 18)
      statusPainel = "Bloq. filtro";

   double resDia = ResultadoDiaRobo();
   double resSemana = ResultadoSemanaRobo();
   double resMes = ResultadoMesRobo();
   double resTotal = ResultadoTotalRobo();

   int x = PainelX;
   int y = PainelY;
   int w = PainelLargura;
   if(w < 410) w = 410;

   color fundo = (color)0x080808;
   color fundoBloco = (color)0x121212;
   color borda = clrGold;
   color destaque = clrGold;

   int qtdRes = (PainelMostrarResultadoDia?1:0) + (PainelMostrarResultadoSemana?1:0) + (PainelMostrarResultadoMes?1:0) + (PainelMostrarResultadoTotal?1:0);
   int hRes = 62 + MathMax(qtdRes,1)*15 + 18;
   int hPainel = 96 + 128 + 12 + 144 + 12 + hRes + 12 + 64 + 12;

   PainelRetangulo("PBFX_PANEL_BG", x, y, w, hPainel, destaque, fundo);

   PainelTextoCentro("PBFX_PANEL_TITULO1", x + w/2, y+30, "ROMPEDOR FLOW", clrGold, PainelFonteBase+18, "Arial Black");
   PainelTextoCentro("PBFX_PANEL_TITULO2", x + w/2, y+70, NomeSecundarioPainel, clrWhite, PainelFonteBase+3, "Arial Bold");

   int by = y + 96;
   PainelRetangulo("PBFX_PANEL_BOX_STATUS", x+10, by, w-20, 128, borda, fundoBloco);
   PainelCabecalho("PBFX_PANEL_H_STATUS", x+24, by+12, "STATUS OPERACIONAL");
   int i=0;
   PainelLinhaInfo("PBFX_STATUS", i, x+32, by+46, "Modo:", (LimiteFinanceiroAtingido() ? "BLOQUEADO" : "NORMAL"), (LimiteFinanceiroAtingido()?clrTomato:clrLime));
   PainelLinhaInfo("PBFX_STATUS", i, x+32, by+46, "Status:", statusPainel, clrGold);
   PainelLinhaInfo("PBFX_STATUS", i, x+32, by+46, "1ª Barra:", (barraValida ? "OK" : "AGUARDANDO"), (barraValida?clrLime:clrGold));
   PainelLinhaInfo("PBFX_STATUS", i, x+32, by+46, "Canal Formado:", SimNao(linhaCompra>0.0 && linhaVenda>0.0), (linhaCompra>0.0 && linhaVenda>0.0 ? clrLime : clrTomato));
   PainelLinhaInfo("PBFX_STATUS", i, x+32, by+46, "Reversão:", AtivoDesativo(UsarReversao), (UsarReversao?clrLime:clrTomato));

   by += 140;
   PainelRetangulo("PBFX_PANEL_BOX_OPER", x+10, by, w-20, 144, borda, fundoBloco);
   PainelCabecalho("PBFX_PANEL_H_OPER", x+24, by+12, "OPERAÇÃO ATUAL");
   i=0;
   PainelLinhaInfo("PBFX_OPER", i, x+32, by+48, "Direção:", direcao, (ladoAtual==LADO_COMPRA?clrLime:(ladoAtual==LADO_VENDA?clrTomato:clrSilver)));
   PainelLinhaInfo("PBFX_OPER", i, x+32, by+48, "Lote Atual:", DoubleToString(CalcularVolumeInicial(),2), clrWhite);
   PainelLinhaInfo("PBFX_OPER", i, x+32, by+48, "Volume C/V:", DoubleToString(vc,2)+" / "+DoubleToString(vv,2), clrWhite);
   PainelLinhaInfo("PBFX_OPER", i, x+32, by+48, "Take Profit:", (cestaReversaoAtiva && alvoCestaReversao>0.0 ? DoubleToString(alvoCestaReversao,_Digits) : DoubleToString(DistanciaTP(false),1)+" pts"), clrLime);
   PainelLinhaInfo("PBFX_OPER", i, x+32, by+48, "Stop:", (UsarReversao ? NomeModoStopReversao() : NomeModoStopOperacao()), clrTomato);
   PainelLinhaInfo("PBFX_OPER", i, x+32, by+48, "Situação:", (cestaReversaoAtiva ? "CESTA ATIVA" : "AGUARDANDO"), (cestaReversaoAtiva?clrDeepSkyBlue:clrGold));

   by += 156;
   PainelRetangulo("PBFX_PANEL_BOX_RES", x+10, by, w-20, hRes+8, borda, fundoBloco);
   PainelCabecalho("PBFX_PANEL_H_RES", x+24, by+12, "RESULTADOS");
   PainelBotaoCheck("PBFX_TOGGLE_DIA",    x+24,  by+42, "Dia",    PainelMostrarResultadoDia);
   PainelBotaoCheck("PBFX_TOGGLE_SEMANA", x+108, by+42, "Semana", PainelMostrarResultadoSemana);
   PainelBotaoCheck("PBFX_TOGGLE_MES",    x+210, by+42, "Mês",    PainelMostrarResultadoMes);
   PainelBotaoCheck("PBFX_TOGGLE_TOTAL",  x+292, by+42, "Total",  PainelMostrarResultadoTotal);
   i=0;
   if(PainelMostrarResultadoDia)    PainelLinhaInfo("PBFX_RES", i, x+32, by+78, "DIA:", DoubleToString(resDia,2), CorValorFinanceiro(resDia));
   if(PainelMostrarResultadoSemana) PainelLinhaInfo("PBFX_RES", i, x+32, by+78, "SEMANA:", DoubleToString(resSemana,2), CorValorFinanceiro(resSemana));
   if(PainelMostrarResultadoMes)    PainelLinhaInfo("PBFX_RES", i, x+32, by+78, "MÊS:", DoubleToString(resMes,2), CorValorFinanceiro(resMes));
   if(PainelMostrarResultadoTotal)  PainelLinhaInfo("PBFX_RES", i, x+32, by+78, "TOTAL:", DoubleToString(resTotal,2), CorValorFinanceiro(resTotal));
   for(int limpaRes=i; limpaRes<6; limpaRes++)
   {
      ObjectDelete(0, "PBFX_RES_L" + IntegerToString(limpaRes));
      ObjectDelete(0, "PBFX_RES_V" + IntegerToString(limpaRes));
   }

   by += hRes + 20;
   PainelRetangulo("PBFX_PANEL_BOX_STATS", x+10, by, w-20, 64, borda, fundoBloco);
   PainelTextoCentro("PBFX_STAT_1", x+72, by+14, "TRADES", clrGold, PainelFonteBase+1, "Arial Bold");
   PainelTextoCentro("PBFX_STAT_1V", x+72, by+44, "Hoje: "+IntegerToString(TradesDiaRobo()), clrWhite, PainelFonteBase, "Arial");
   PainelTextoCentro("PBFX_STAT_2", x+w/2, by+14, "SEMANA", clrGold, PainelFonteBase+1, "Arial Bold");
   PainelTextoCentro("PBFX_STAT_2V", x+w/2, by+44, IntegerToString(TradesSemanaRobo()), clrWhite, PainelFonteBase, "Arial");
   PainelTextoCentro("PBFX_STAT_3", x+w-72, by+14, "CICLOS", clrGold, PainelFonteBase+1, "Arial Bold");
   PainelTextoCentro("PBFX_STAT_3V", x+w-72, by+44, IntegerToString(ciclosExecutadosHoje)+"/"+(MaxOperacoesDia>0?IntegerToString(MaxOperacoesDia):"Livre"), clrWhite, PainelFonteBase, "Arial");

   ChartRedraw(0);
}


bool EAExpirado()
{
   if(!EA_USAR_EXPIRACAO) return false;
   return (TimeCurrent() > EA_DATA_EXPIRACAO);
}

string MensagemEAExpirado()
{
   return "ROMPEDOR FLOW EXPIRADO\n"
          + "Data limite: " + TimeToString(EA_DATA_EXPIRACAO, TIME_DATE|TIME_MINUTES) + "\n"
          + EA_CONTATO_EXPIRACAO;
}

bool VerificarExpiracaoEA()
{
   if(!EAExpirado()) return false;

   statusDia = "EA EXPIRADO";
   CancelarPendentesDoRobo();
   Comment(MensagemEAExpirado());

   if(!avisoExpiracaoMostrado)
   {
      Alert(MensagemEAExpirado());
      avisoExpiracaoMostrado = true;
   }
   return true;
}

void ExecutarEstrategia()
{
   AtualizarPainel();
   if(VerificarExpiracaoEA()) return;
   if(fechandoCesta) return;
   if(!estrategiaLiberadaHoje || !barraValida) return;
   if(linhaCompra <= 0 || linhaVenda <= 0) return;

   VerificarAlvoCestaReversao();
   GerenciarProtecaoCestaReversao();
   GerenciarProtecaoOrdemUnica();
   VerificarStopCestaReversao();
   GarantirTPRealDasOperacoes();
   PlotarResultadoOperacaoPendente();

   if(LimiteFinanceiroAtingido())
   {
      CancelarPendentesDoRobo();
      return;
   }

   datetime fim = FimOperacaoParaDia(diaAtual > 0 ? diaAtual : DiaBaseOperacional(TimeCurrent()));
   if(TimeCurrent() > fim)
   {
      CancelarPendentesDoRobo();
      if(!encerradoHorario && FecharNoHorarioFinal) FecharPosicaoDoRobo();
      encerradoHorario = true;
      statusDia = "Horário final encerrado";
      return;
   }
   if(!DentroDoHorario()) return;

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   double volCompra, volVenda, pmCompra, pmVenda;
   bool temCesta = ObterCestaDoRobo(volCompra, volVenda, pmCompra, pmVenda);

   if(temCesta)
   {
      DetectarEntradaOuReversaoPorPendente(volCompra, volVenda);

      if(!UsarReversao)
      {
         CancelarPendentesDoRobo();
         return;
      }

      if(!CanalPermiteReversao())
      {
         CancelarPendentesDoRobo();
         statusDia = "Entrada ativa | reversão bloqueada pelo canal";
         return;
      }

      // Depois que entrou em reversão, não reverte novamente. Só espera alvo ou stop/horário.
      if(cestaReversaoAtiva || reversaoJaUsada) return;

      if(UsarOrdensPendentes)
      {
         ArmarPendenteReversao(volCompra, volVenda);
         return;
      }

      double volumeReversao = CalcularVolumeReversao(CalcularVolumeInicial());

      double precoRevVendaManual = PrecoReversaoParaVenda();
      double precoRevCompraManual = PrecoReversaoParaCompra();

      if(volCompra > volVenda && bid <= precoRevVendaManual && OperarVendas && FiltroMediaPermite(LADO_VENDA))
      {
         reversaoJaUsada = true;
         cestaReversaoAtiva = true;
         alvoCestaReversao = NormalizarPreco(precoRevVendaManual - DistanciaTP(false) * _Point);
         precoReferenciaCesta = precoRevVendaManual;
         beCestaAtivo = false;
         trailingCestaAtivo = false;
         stopCestaReversao = CalcularStopCestaReversao(LADO_VENDA);
         DesenharLinhasCestaAtual();
         double volOriginal = volCompra - volVenda;
         if(volOriginal > 0.0)
            volumeReversao = CalcularVolumeReversao(volOriginal);
         if(volumeReversao <= 0.0) return;
         volumeReversaoCalculado = volumeReversao;
         RemoverTPDasCestasAbertas();
         if(AbrirVenda(true)) statusDia = "Reversão para VENDA ativa";
         volumeReversaoCalculado = 0.0;
      }
      else if(volVenda > volCompra && ask >= precoRevCompraManual && OperarCompras && FiltroMediaPermite(LADO_COMPRA))
      {
         reversaoJaUsada = true;
         cestaReversaoAtiva = true;
         alvoCestaReversao = NormalizarPreco(precoRevCompraManual + DistanciaTP(false) * _Point);
         precoReferenciaCesta = precoRevCompraManual;
         beCestaAtivo = false;
         trailingCestaAtivo = false;
         stopCestaReversao = CalcularStopCestaReversao(LADO_COMPRA);
         DesenharLinhasCestaAtual();
         double volOriginal = volVenda - volCompra;
         if(volOriginal > 0.0)
            volumeReversao = CalcularVolumeReversao(volOriginal);
         if(volumeReversao <= 0.0) return;
         volumeReversaoCalculado = volumeReversao;
         RemoverTPDasCestasAbertas();
         if(AbrirCompra(true)) statusDia = "Reversão para COMPRA ativa";
         volumeReversaoCalculado = 0.0;
      }
      return;
   }

   VerificarFechamentoPorTPManual();
   cicloAtualContabilizado = false;

   if(MaxOperacoesDia > 0 && ciclosExecutadosHoje >= MaxOperacoesDia)
   {
      CancelarPendentesDoRobo();
      return;
   }

   if(EntradaBloqueadaNesteCandle())
   {
      CancelarPendentesDoRobo();
      statusDia = "Aguardando próximo candle";
      return;
   }

   if(UsarOrdensPendentes)
   {
      // Sem posição: mantém as pendentes fixas na linha. Não cancela/recria a cada tick.
      ArmarPendentesIniciais();
      return;
   }

   // Fallback antigo a mercado, caso o usuário desligue pendentes.
   if(ask >= linhaCompra && OperarCompras && ultimoLadoExecutado != LADO_COMPRA && FiltroMediaPermite(LADO_COMPRA))
   {
      reversaoJaUsada = false;
      cestaReversaoAtiva = false;
      alvoCestaReversao = 0.0;
      stopCestaReversao = 0.0;
      if(AbrirCompra(false)) { ciclosExecutadosHoje++; statusDia = "Compra inicial ativa"; }
   }
   else if(bid <= linhaVenda && OperarVendas && ultimoLadoExecutado != LADO_VENDA && FiltroMediaPermite(LADO_VENDA))
   {
      reversaoJaUsada = false;
      cestaReversaoAtiva = false;
      alvoCestaReversao = 0.0;
      stopCestaReversao = 0.0;
      if(AbrirVenda(false)) { ciclosExecutadosHoje++; statusDia = "Venda inicial ativa"; }
   }
}


void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(trans.deal == 0) return;
   if(!HistoryDealSelect(trans.deal)) return;

   if(HistoryDealGetString(trans.deal, DEAL_SYMBOL) != _Symbol) return;
   if((ulong)HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != NumeroMagico) return;

   ENUM_DEAL_ENTRY entradaDeal = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   if(entradaDeal != DEAL_ENTRY_OUT && entradaDeal != DEAL_ENTRY_INOUT && entradaDeal != DEAL_ENTRY_OUT_BY)
      return;

   double resultadoDeal = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
                        + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                        + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);

   resultadoOperacaoPendente += resultadoDeal;
   horarioUltimoFechamentoOperacao = (datetime)HistoryDealGetInteger(trans.deal, DEAL_TIME);
   precoUltimoFechamentoOperacao = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
   horarioPlotResultado = TimeCurrent() + MathMax(1, AguardarSegundosParaPlotarResultado);
   if(BloquearReentradaMesmoCandle)
      candleBloqueadoAposFechamento = iTime(_Symbol, _Period, 0);
}


void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id != CHARTEVENT_OBJECT_CLICK) return;
   if(sparam == "PBFX_TOGGLE_DIA" || sparam == "PBFX_TOGGLE_DIA_BOX")
      PainelMostrarResultadoDia = !PainelMostrarResultadoDia;
   else if(sparam == "PBFX_TOGGLE_SEMANA" || sparam == "PBFX_TOGGLE_SEMANA_BOX")
      PainelMostrarResultadoSemana = !PainelMostrarResultadoSemana;
   else if(sparam == "PBFX_TOGGLE_MES" || sparam == "PBFX_TOGGLE_MES_BOX")
      PainelMostrarResultadoMes = !PainelMostrarResultadoMes;
   else if(sparam == "PBFX_TOGGLE_TOTAL" || sparam == "PBFX_TOGGLE_TOTAL_BOX")
      PainelMostrarResultadoTotal = !PainelMostrarResultadoTotal;
   else
      return;

   AtualizarPainel();
   ChartRedraw(0);
}

int OnInit()
{
   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetDeviationInPoints(SlippagePontos);

   if(!VerificarLicencaOnline())
   {
      if(!LicenseFailureMessageShown)
         Alert("Licenca invalida, expirada ou sem comunicacao com o servidor para ", RobotName, ".");
      return INIT_FAILED;
   }
   EnviarPerformanceOnline();
   EventSetTimer(LicenseCheckIntervalSeconds);

   if(RemoverGradeDoGrafico)
      ChartSetInteger(0, CHART_SHOW_GRID, false);

   if(VerificarExpiracaoEA())
      AtualizarPainel();

   AtualizarDia();
   DesenharHistoricoDias();
   return INIT_SUCCEEDED;
}

void OnTick()
{
   AtualizarDia();

   if(VerificarExpiracaoEA())
   {
      AtualizarPainel();
      ChartRedraw(0);
      return;
   }

   PlotarResultadoOperacaoPendente();
   ExecutarEstrategia();
   AtualizarPainel();
}

void OnTimer()
{
   if(!VerificarLicencaOnline())
   {
      if(!LicenseFailureMessageShown)
         Alert("Licenca invalida, expirada ou sem comunicacao com o servidor para ", RobotName, ".");
      EventKillTimer();
      ExpertRemove();
      return;
   }
   EnviarPerformanceOnline();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   // Mantém os desenhos no gráfico para estudo visual.
}
//+------------------------------------------------------------------+
