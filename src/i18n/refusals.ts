import { currentLanguage } from '../session/language';

/**
 * What the server refuses, said in the reader's language.
 *
 * Keyed on `extensions.code`, which every `…ExceptionResolver` sends: the
 * exception's own class name with `Exception` dropped. `{name}` and its
 * siblings are `extensions.arguments`, by name rather than by position, so a
 * translation can put the value where Polish wants it.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately not in here
 *
 * A refusal whose only argument is the whole sentence. Several of them - a
 * model that cannot be used, a link that will not do, a move that was turned
 * down - carry a sentence assembled where the decision was made, and a Polish
 * frame around an English sentence reads worse than the English sentence. Those
 * fall back to `message`, which is complete and correct.
 *
 * And a code two exception classes would answer to. Seven names are declared
 * twice - once in `app` and once in a module - and two of those pairs do not
 * say the same thing, so the code is ambiguous and cannot be translated without
 * risking the wrong sentence. `catalogue-check` fails if a code in here is
 * declared more than once, so this list cannot rot into that quietly.
 *
 * Anything absent shows the English the server sent. That is the property worth
 * protecting: a refusal is never a bare code on a screen.
 */
const PL: Record<string, string> = {
  // --- a name that is required, and one that is taken --------------------
  ActionNameInvalid: 'Nazwa akcji jest wymagana',
  AgentNameInvalid: 'Nazwa agenta jest wymagana',
  ChatTitleInvalid: 'Czat potrzebuje tytułu',
  ConditionNameInvalid: 'Nazwa warunku jest wymagana',
  ConnectionNameInvalid: 'Nazwa połączenia jest wymagana',
  IssueTitleInvalid: 'Zgłoszenie potrzebuje tytułu',
  McpServerNameInvalid: 'Nazwa serwera MCP jest wymagana',
  MemoryCatalogNameInvalid: 'Nazwa katalogu jest wymagana',
  MemoryTitleInvalid: 'Tytuł wspomnienia jest wymagany',
  ModelNameInvalid: 'Nazwa modelu jest wymagana',
  ModelProviderNameInvalid: 'Nazwa dostawcy jest wymagana',
  ProxyRuleNameInvalid: 'Nazwa reguły proxy jest wymagana',
  RoleNameInvalid: 'Rola potrzebuje nazwy',
  ShellNameInvalid: 'Nazwa powłoki jest wymagana',
  SkillCatalogNameInvalid: 'Katalog umiejętności potrzebuje nazwy',
  SkillNameInvalid: 'Nazwa umiejętności jest wymagana',
  TriggerNameInvalid: 'Nazwa wyzwalacza jest wymagana',
  UserNameInvalid: 'Użytkownik potrzebuje nazwy',
  VariableCatalogNameInvalid: 'Nazwa katalogu jest wymagana',
  WorkflowNameInvalid: 'Nazwa przepływu pracy jest wymagana',
  WorkspaceNameInvalid: 'Nazwa przestrzeni roboczej jest wymagana',

  ActionNameTaken: 'Akcja o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  AgentNameTaken: 'Agent o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  ConditionNameTaken: 'Warunek o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  FunctionNameTaken: 'Funkcja o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  ImportNameTaken: 'Ten import zawiera już coś o nazwie „{name}”',
  McpServerNameTaken: 'Serwer MCP o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  MemoryCatalogNameTaken: 'Katalog pamięci o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  ObjectNameTaken: 'Ta przestrzeń robocza ma już obiekt o nazwie {name}',
  RoleNameTaken: 'Rola o nazwie „{name}” już istnieje',
  SkillCatalogNameTaken: 'Ta przestrzeń robocza ma już katalog umiejętności o nazwie {name}',
  SkillNameTaken: 'Umiejętność o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  ToolNameTaken: 'Narzędzie o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  TriggerNameTaken: 'Wyzwalacz o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  VariableCatalogNameTaken: 'Katalog o nazwie „{name}” już istnieje w tej przestrzeni roboczej',
  VariableNameTaken: 'Katalog {catalog} zawiera już zmienną o nazwie „{name}”',
  WorkflowNameTaken: 'Przepływ pracy o nazwie „{name}” już istnieje',
  WorkspaceNameTaken: 'Przestrzeń robocza o nazwie „{name}” już istnieje',
  UserNameTaken: 'Użytkownik o nazwie „{username}” już istnieje',
  ToolParamDuplicate: 'To narzędzie przyjmuje już parametr o nazwie „{name}”',
  TriggerWebhookPathTaken: 'Inny wyzwalacz odpowiada już pod /api/webhooks/{path}',

  // --- something that is not there ---------------------------------------
  ActionNotFound: 'Nie ma akcji o identyfikatorze {id}',
  AgentNotFound: 'Nie ma agenta o identyfikatorze {id}',
  AttachmentNotFound: 'Nie ma załącznika o identyfikatorze {id}',
  ChatSessionNotFound: 'Nie ma czatu o identyfikatorze {id}',
  ComponentRevisionNotFound: 'Nie ma wersji o identyfikatorze {id}',
  ConditionNotFound: 'Nie ma warunku o identyfikatorze {id}',
  FunctionNotFound: 'Nie ma funkcji o identyfikatorze {id}',
  ImportNotFound: 'Nie ma funkcji {id} do zaimportowania',
  IssueAttachmentNotFound: 'Nie ma załącznika o identyfikatorze {id}',
  IssueCommentNotFound: 'Nie ma komentarza o identyfikatorze {id}',
  IssueLinkNotFound: 'Nie ma odnośnika o identyfikatorze {id}',
  IssueNotFound: 'Nie ma zgłoszenia o identyfikatorze {id}',
  IssueRelationNotFound: 'Nie ma powiązania o identyfikatorze {id}',
  LlmSessionNotFound: 'Nie ma sesji LLM o identyfikatorze {id}',
  MemoryCatalogNotFound: 'Nie ma katalogu pamięci o identyfikatorze {id}',
  MemoryNotFound: 'Nie ma wspomnienia o identyfikatorze {id}',
  ObjectNotFound: 'Nie ma obiektu o identyfikatorze {id}',
  RoleNotFound: 'Nie ma roli o identyfikatorze {id}',
  SkillCatalogNotFound: 'Nie ma katalogu umiejętności o identyfikatorze {id}',
  SkillNotFound: 'Nie ma umiejętności o identyfikatorze {id}',
  TokenNotFound: 'Nie ma tokena o identyfikatorze {id}',
  ToolNotFound: 'Nie ma narzędzia o identyfikatorze {id}',
  TriggerNotFound: 'Nie ma wyzwalacza o identyfikatorze {id}',
  UserNotFound: 'Nie ma użytkownika o identyfikatorze {id}',
  VariableCatalogNotFound: 'Nie ma katalogu o identyfikatorze {id}',
  VariableNotFound: 'Nie ma zmiennej o identyfikatorze {id}',
  WorkflowPublicationNotFound: 'Nie ma publikacji o identyfikatorze {id}',
  WorkspaceNotFound: 'Nie ma przestrzeni roboczej o identyfikatorze {id}',
  WorkflowNotAssigned:
    'Przepływ pracy {workflowId} nie jest przypisany do przestrzeni roboczej {workspaceId}',

  ActionNotInCatalogue: 'Akcji {id} nie ma w katalogu tej przestrzeni roboczej',
  ConditionNotInCatalogue: 'Warunku {id} nie ma w katalogu tej przestrzeni roboczej',
  ObjectNotInCatalogue: 'Obiektu {id} nie ma w katalogu tej przestrzeni roboczej',
  TriggerNotInCatalogue: 'Wyzwalacza {id} nie ma w katalogu tej przestrzeni roboczej',

  // --- something that is still in use ------------------------------------
  ActionInUse: '{name} jest używana przez {users}, więc nie można jej usunąć',
  AgentInUse: '{name} jest używany przez {nodes}, więc nie można go usunąć',
  ConditionInUse: '{name} jest używany przez {used}',
  FunctionInUse: '{name} jest wywoływana przez {callers}',
  FunctionImported: '{name} jest importowana przez {importers}',
  MemoryCatalogInUse: '{name} jest przyznany agentom {agents}, więc nie można go usunąć',
  ObjectInUse: '{name} jest używany przez {users}, więc nie można go usunąć',
  RoleInUse:
    '{name} jest przypisana do {workspaces}. Zdejmij ją najpierw z tych przestrzeni roboczych — ' +
    'inaczej ci, którzy ją mają, tracą do nich dostęp bez niczyjej decyzji.',
  SkillCatalogInUse: '{name} jest przyznany agentom {agents}, więc nie można go usunąć',
  ToolInUse: '{name} jest przyznane agentom {agents}, więc nie można go usunąć',
  TriggerInUse: '{name} jest używany przez {users}, więc nie można go usunąć',
  VariableCatalogNotEmpty:
    '{name} zawiera jeszcze {held} zmiennych. Przenieś je albo usuń najpierw; katalog jest ' +
    'folderem, a jego opróżnienie to decyzja o jego zawartości.',
  VariableInUse:
    '„{name}” jest parametrem zewnętrznym funkcji {functions}. Zdejmij ją najpierw z tych ' +
    'funkcji; usunięcie jej tutaj zmieniłoby to, co dostają.',
  VariableHeldAsCredential:
    '„{name}” jest poświadczeniem: {readers}. Daj im najpierw własną wartość albo wskaż inny ' +
    'sekret — usunięcie jej tutaj nie zostawiłoby niczym się uwierzytelnić.',
  VariableSecrecyHeld:
    '„{name}” jest poświadczeniem: {readers}, więc musi pozostać sekretem. Wartość czyta się ' +
    'razem z listą, a klucz na liście to klucz na ekranie.',
  RoleBuiltIn:
    '„{name}” jest wbudowana i nie da się jej edytować ani usunąć. Instalacja bez roli ' +
    'administratora to instalacja, której nikt nie może administrować.',

  // --- what a form got wrong ---------------------------------------------
  EmailInvalid: '„{email}” nie wygląda na adres e-mail',
  FunctionNameInvalid: '„{name}” nie jest nazwą, pod jaką da się wywołać skrypt',
  ToolNameInvalid: '„{name}” nie jest nazwą, pod jaką da się wywołać skrypt',
  FunctionParamInvalid: '„{name}” nie jest nazwą, jaką może mieć parametr',
  ToolParamInvalid: '„{name}” nie jest nazwą, jaką może mieć parametr',
  ImportNameInvalid: '„{name}” nie jest nazwą, pod jaką da się nazwać import',
  VariableNameInvalid:
    '„{name}” nie może być nazwą zmiennej. Nazwa to litery, cyfry i podkreślenia, zaczynające ' +
    'się od litery — funkcja dostaje ją jako argument, a argument musi dać się nazwać.',
  ImportCycle: 'Ten import utworzyłby pętlę: {path}',
  ConditionCycle: '{name} zawierałby sam siebie',
  ConditionFunctionRequired: 'Warunek funkcyjny potrzebuje funkcji do wywołania',
  ConditionMembersRequired: 'Warunek złożony potrzebuje co najmniej dwóch warunków do połączenia',
  ConditionFunctionElsewhere:
    '{name} należy do innej przestrzeni roboczej; warunek może wywołać funkcje tej przestrzeni ' +
    'roboczej i funkcje wtyczki',
  ConditionFunctionNotBoolean:
    '{name} zwraca {returnType}; warunek potrzebuje funkcji zwracającej wartość logiczną',
  FunctionObjectRequired:
    '„{name}” jest zadeklarowana jako obiekt, ale nie wybrano żadnego. Wskaż jeden z obiektów ' +
    'tej przestrzeni roboczej albo użyj mapy dla struktury bez określonego kształtu.',
  ToolObjectRequired:
    '„{name}” jest zadeklarowane jako obiekt, ale nie wybrano żadnego. Wskaż jeden z obiektów ' +
    'tej przestrzeni roboczej albo użyj mapy dla struktury bez określonego kształtu.',
  FunctionCodeIncomplete:
    'Brakuje: {missing}. TypeScript funkcji i skompilowany z niego JavaScript zapisywane są ' +
    'razem, żeby to, co się wykonuje, było zawsze tym, co napisano.',
  ToolCodeIncomplete:
    'Brakuje: {missing}. TypeScript narzędzia i skompilowany z niego JavaScript zapisywane są ' +
    'razem, żeby to, co się wykonuje, było zawsze tym, co napisano.',
  ActionSettingMissing: 'Ten rodzaj akcji potrzebuje: {setting}',
  ActionHoldsPlaceholder:
    '{setting} jest używane dokładnie tak, jak zapisano, więc {{…}} zostałoby wysłane jako ' +
    'tekst. Zostaw puste i pozwól każdemu węzłowi powiedzieć, co tam trafia.',
  ActionHeaderAmbiguous:
    'Nagłówkowi „{name}” podano zarówno wartość, jak i zmienną do odczytania. Może być jedno ' +
    'albo drugie.',
  ActionHeaderEmpty:
    'Nagłówkowi „{name}” nie podano ani wartości, ani zmiennej. Jeśli o to chodziło, usuń ' +
    'zamiast tego cały wiersz.',
  ActionHeaderVariableElsewhere:
    'Ta zmienna należy do innej przestrzeni roboczej, więc nagłówek „{name}” nie może jej odczytać.',
  AttachmentTooLarge: '„{name}” jest większy niż {limitMb} MB, ile może mieć załącznik',
  AttachmentsDisabled: 'Załączniki są wyłączone w tej instalacji',
  ChatDisabled: 'Czat jest wyłączony w tej instalacji',
  ChatMessageEmpty: 'Nie ma czego wysłać',
  ChatModelNotChosen: 'Ten czat nie ma modelu, który mógłby odpowiedzieć; wybierz najpierw jeden',
  ChatPictureModelNotChosen:
    'Ta przestrzeń robocza nie ma modelu obrazu. Wybierz jeden w ustawieniach czatu przestrzeni ' +
    'roboczej albo dodaj go w Modelach.',
  ChatPictureUnstorable:
    'Narysowany obraz jest przechowywany jako załącznik, a załączniki są wyłączone w tej instalacji.',
  ConnectionUrlInvalid: 'Adres połączenia jest wymagany',
  McpServerAddressInvalid: 'Adres serwera MCP jest wymagany',
  MemoryContentInvalid: 'Wspomnienie potrzebuje czegoś do zapamiętania',
  ModelIdInvalid: 'Identyfikator modelu jest wymagany',
  ModelProviderEndpointInvalid: 'Punkt końcowy API dostawcy jest wymagany',
  IssueCommentEmpty: 'Komentarz musi coś zawierać',
  IssueRelationToItself: 'Zgłoszenia nie da się powiązać z samym sobą',
  IssueRelationElsewhere:
    'Zgłoszenia można wiązać tylko ze zgłoszeniami z tej samej przestrzeni roboczej',
  IssueRelationAlready: 'Te dwa są już powiązane: {said}. Zdejmij najpierw to powiązanie.',
  IssueAssigneeInvalid: '{what} nie jest czymś w tej przestrzeni roboczej, do czego da się przypisać zgłoszenie',
  IssueAssigneeKindMissing: 'Przypisanie to rodzaj i identyfikator razem; {id} przyszło bez rodzaju',
  IssueObserverInvalid: '{what} nie jest czymś w tej przestrzeni roboczej, co może obserwować zgłoszenie',
  IssueAttachmentNotYours: 'Załącznik może usunąć tylko ten, kto go dołączył',
  IssueCommentNotYours: 'Komentarz może edytować tylko ten, kto go napisał',
  IssueCommentNotYoursToRemove:
    'Komentarz może usunąć tylko ten, kto go napisał, lub administrator tej przestrzeni roboczej',
  IssueLinkNotYours: 'Odnośnik może usunąć tylko ten, kto go dodał',
  LlmSessionKeyMissing: 'Sesja potrzebuje klucza; sam prefiks jeszcze jej nie nazywa',
  LlmSessionKeyTooLong:
    'Klucz sesji ma najwyżej tyle znaków, ile pozwala limit — wliczając prefiks — a ten ma {length}',
  RetentionOutOfRange: '{days} to nie jest liczba dni, przez jaką da się przechowywać historię.',
  RevisionNotRestorable: '„{name}” nie jest tu edytowalne, więc nie da się przywrócić jego wersji',
  TriggerConnectionRequired: 'Wyzwalacz połączenia przychodzącego potrzebuje połączenia i zdarzenia',
  TriggerPayloadInvalid:
    'Ładunek musi być obiektem JSON, żeby jego pola dały się odczytać jako wejście',
  TriggerScheduleRequired: 'Zaplanowany wyzwalacz potrzebuje wyrażenia cron',
  TriggerScheduleInvalid: '„{cron}” nie jest wyrażeniem cron, jakie da się tu zaplanować',
  TriggerScheduleUnreachable: '„{cron}” to wyrażenie cron, którego chwila nigdy nie nadchodzi',
  TriggerWebhookAuthFunctionRequired: 'Uwierzytelnianie funkcją potrzebuje funkcji do zapytania',
  TriggerWebhookAuthFunctionNotBoolean:
    '{name} nie odpowiada prawdą ani fałszem. Webhook uwierzytelnia funkcja mówiąca tak albo nie.',
  TriggerWebhookPathRequired: 'Wyzwalacz webhooka potrzebuje ścieżki, pod którą odpowiada',
  TriggerWebhookShapeRequired:
    'Wyzwalacz webhooka potrzebuje obiektu mówiącego, co musi zawierać żądanie',
  TriggerWebhookPathInvalid:
    '„{path}” nie jest ścieżką w tej instalacji. Webhook odpowiada tutaj, więc podaj miejsce ' +
    'tutaj — „build/finished”, a nie własny adres URL.',
  TriggerActionUnsupported: 'Nic nie dostarcza jeszcze zdarzeń {action}, więc wyzwalacz nie ma czego nasłuchiwać',
  SecretCredentialAmbiguous:
    'Pole trzyma własne poświadczenie albo czyta je ze zmiennej przestrzeni roboczej, nie oba ' +
    'naraz. Wyślij wartość albo zmienną, nie jedno i drugie.',
  NoShellAvailable: 'W tej instalacji nie skonfigurowano żadnej powłoki albo żadna nie jest włączona',
  FunctionExternallyManaged:
    '„{name}” pochodzi z wtyczki i nie da się jej tutaj zmienić. Wczytaj wtyczkę ponownie, aby ' +
    'zmienić to, co deklaruje.',
  ImportNotEditable:
    '{name} pochodzi z wtyczki, więc nie da się jej zaimportować. Skieruj na nią akcję zamiast tego.',
  UserExternallyManaged:
    '„{username}” pochodzi od dostawcy tożsamości i nie da się go tutaj edytować. To, co mówi ' +
    'o nim dostawca, nadpisze to przy jego następnym logowaniu.',
  PasswordNotSettable:
    '„{username}” loguje się przez dostawcę tożsamości, więc nie ma tu hasła do ustawienia',
  PasswordTooShort: 'Hasło potrzebuje co najmniej {shortest} znaków',
  PasswordWrong: 'To nie jest obecne hasło',

  // --- who is asking ------------------------------------------------------
  SignInRequired: 'Zaloguj się, aby to zobaczyć',
  AdminRequired: 'Ta czynność wymaga roli administratora',
  WorkspaceForbidden: 'To nie istnieje albo nie masz do tego dostępu',
  WorkspaceAdminRequired:
    'Ta czynność wymaga roli administrującej przestrzenią {name}. Móc widzieć przestrzeń roboczą ' +
    'to nie to samo co ją prowadzić, a rola administrująca inną przestrzenią nie administruje tą.',
  WorkspaceAdminRoleNotAssigned:
    '{names} nie mogą administrować tą przestrzenią roboczą, nie będąc do niej przypisani. ' +
    'Dodaj je do ról, które ją otwierają, a potem oznacz jako administrujące.',
};

const CATALOGUES: Record<string, Record<string, string>> = { pl: PL };

/** The refusals for the language in force, or nothing where there are none. */
export function refusalsIn(): Record<string, string> {
  return CATALOGUES[currentLanguage()] ?? {};
}
