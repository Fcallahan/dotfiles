# C# Code Quality Rules

Use these rules as engineering heuristics, not mechanical laws. Repository conventions take precedence when they are intentional, safe, and current. Apply a rule only when it improves comprehension, cohesion, maintainability, correctness, or operational safety.

## Core Principles

### 1. Optimize for comprehension

Code is read far more frequently than it is written.

Prefer code that makes the reader’s required mental model smaller.

Readable code should make it easy to answer:

* What is this code doing?
* Why is it doing it?
* What conditions control the behavior?
* What state is being changed?
* Which external systems are involved?
* What assumptions must remain true?
* Where should a future engineer make a related change?

Do not optimize primarily for:

* minimum line count;
* maximum expression density;
* clever language features;
* avoiding all duplication;
* creating the most generic abstraction;
* demonstrating advanced syntax.


### 2. Match the repository before inventing a pattern

Before creating a new abstraction, determine how the repository already solves similar problems.

Avoid introducing a new:

* result type;
* repository pattern;
* service wrapper;
* validation approach;
* mapping layer;
* factory;
* strategy;
* base class;
* extension-method family;
* exception hierarchy;
* response envelope;
* mediator convention;

when a suitable repository pattern already exists.

A locally consistent implementation is usually easier to maintain than an individually elegant implementation that introduces a second way to solve the same problem.


## Naming

### Use names that communicate intent

Names should express domain meaning, not merely data type or implementation mechanism.

Avoid weak names such as:

```csharp
var data = await repository.GetAsync(cancellationToken);
var result = Process(data);
var item = result.First();
```

Prefer:

```csharp
var pendingEncounters =
    await encounterRepository.GetPendingEncountersAsync(cancellationToken);

var evaluationResults = EvaluateBillingRules(pendingEncounters);
var firstFailedEvaluation = evaluationResults.First();
```

#### Rule

Use names that describe what a value represents in the current domain context.


### Avoid generic class names

Avoid names such as:

```text
Helper
Manager
Processor
Utility
Common
BaseService
DataService
HandlerService
```

unless the type genuinely represents that concept and the repository consistently uses the term.

Prefer names based on responsibility:

```text
EncounterEligibilityEvaluator
ProviderPayorRateCalculator
BillingRuleSeedService
ClaimSubmissionScheduler
```


### Name boolean values as assertions

Avoid:

```csharp
var coverage = encounter.Payors.Any();
var status = encounter.Status == EncounterStatus.Approved;
var submit = balance > 0;
```

Prefer:

```csharp
var hasPayorCoverage = encounter.Payors.Any();
var isApproved = encounter.Status == EncounterStatus.Approved;
var shouldSubmit = balance > 0;
```

Boolean names should usually begin with terms such as:

* `is`
* `has`
* `can`
* `should`
* `was`
* `requires`
* `contains`
* `supports`


### Name collections using plural nouns

Avoid:

```csharp
var encounter = await repository.GetPendingAsync();
```

when the value contains multiple encounters.

Prefer:

```csharp
var pendingEncounters = await repository.GetPendingAsync();
```


### Do not encode the type when it does not improve meaning

Avoid:

```csharp
var encounterList = new List<Encounter>();
var payorDictionary = new Dictionary<Guid, Payor>();
var nameString = provider.Name;
```

Prefer:

```csharp
var encounters = new List<Encounter>();
var payorsById = new Dictionary<Guid, Payor>();
var providerName = provider.Name;
```

Use the data structure in the name only when it communicates an important access pattern:

```csharp
var payorsById = payors.ToDictionary(payor => payor.Id);
var encountersByCustomer = encounters.ToLookup(
    encounter => encounter.CustomerId);
```


### Avoid misleading names

A method named `Get` should not mutate state.

A method named `Validate` should not persist records.

A method named `Calculate` should not send messages.

Avoid:

```csharp
public async Task<Encounter> GetEncounterAsync(Guid encounterId)
{
    var encounter = await repository.GetAsync(encounterId);
    encounter.MarkAsViewed();
    await repository.SaveChangesAsync();

    return encounter;
}
```

Prefer separating the behaviors or naming the operation according to its full responsibility.


## Intermediate Variables and Expression Clarity

### Name compound business decisions

Avoid embedding multiple independent business decisions in one conditional.

Avoid:

```csharp
if (encounter.Provider?.Settings?.Any(
        setting => setting.Enabled && setting.Type == requiredType) == true
    && clock.UtcNow - encounter.LastProcessedAt > RetryWindow)
{
    await ProcessAsync(encounter, cancellationToken);
}
```

Prefer:

```csharp
var hasRequiredProviderSetting =
    encounter.Provider?.Settings.Any(
        setting => setting.Enabled
            && setting.Type == requiredType) == true;

var isOutsideRetryWindow =
    clock.UtcNow - encounter.LastProcessedAt > RetryWindow;

if (!hasRequiredProviderSetting || !isOutsideRetryWindow)
{
    return;
}

await ProcessAsync(encounter, cancellationToken);
```

#### Rule

Introduce intermediate variables when they name independent business facts or decisions that the reader must reason about.

Do not extract variables merely to increase the number of lines.


### Do not introduce redundant aliases

Avoid:

```csharp
var encounterId = encounter.Id;
var providerId = encounter.ProviderId;

await repository.SaveAsync(
    encounterId,
    providerId,
    cancellationToken);
```

when the local variables provide no additional meaning.

Prefer:

```csharp
await repository.SaveAsync(
    encounter.Id,
    encounter.ProviderId,
    cancellationToken);
```

#### Rule

A local variable should provide at least one of these benefits:

* communicate domain meaning;
* name an intermediate decision;
* prevent repeated work;
* shorten an otherwise distracting expression;
* separate conceptual stages;
* support debugging;
* clarify units;
* make side effects visible.


### Name complex boolean expressions

Avoid:

```csharp
if (encounter.Status == EncounterStatus.Approved
    && encounter.Balance > 0
    && !encounter.Claims.Any(
        claim => claim.Status == ClaimStatus.Pending)
    && clock.UtcNow - encounter.LastSubmittedAt > SubmissionDelay)
{
    await SubmitAsync(encounter, cancellationToken);
}
```

Prefer:

```csharp
var isApproved =
    encounter.Status == EncounterStatus.Approved;

var hasOutstandingBalance =
    encounter.Balance > 0;

var hasPendingClaim =
    encounter.Claims.Any(
        claim => claim.Status == ClaimStatus.Pending);

var submissionDelayHasElapsed =
    clock.UtcNow - encounter.LastSubmittedAt > SubmissionDelay;

var isEligibleForSubmission =
    isApproved
    && hasOutstandingBalance
    && !hasPendingClaim
    && submissionDelayHasElapsed;

if (!isEligibleForSubmission)
{
    return;
}

await SubmitAsync(encounter, cancellationToken);
```

#### Rule

When a condition contains several domain predicates, name the predicates.

The final decision may also be named when it represents a meaningful domain concept.


### Preserve short, obvious conditions

Do not over-extract:

```csharp
var encounterIsNull = encounter is null;

if (encounterIsNull)
{
    throw new ArgumentNullException(nameof(encounter));
}
```

Prefer:

```csharp
if (encounter is null)
{
    throw new ArgumentNullException(nameof(encounter));
}
```

#### Rule

Keep short structural checks inline when naming them does not improve understanding.


### Extract calculations from object construction

Avoid:

```csharp
return new SubmissionRequest
{
    EncounterId = encounter.Id,
    Amount = encounter.Charges.Sum(
        charge => charge.Amount)
        - encounter.Payments.Sum(
            payment => payment.Amount),
    DueDate = clock.UtcNow.AddDays(
        encounter.Customer.IsPriority ? 5 : 30),
    RequiresReview = encounter.Charges.Any(
        charge => charge.Amount > reviewThreshold)
};
```

Prefer:

```csharp
var totalCharges =
    encounter.Charges.Sum(charge => charge.Amount);

var totalPayments =
    encounter.Payments.Sum(payment => payment.Amount);

var outstandingBalance =
    totalCharges - totalPayments;

var paymentTerm = encounter.Customer.IsPriority
    ? PriorityPaymentTerm
    : StandardPaymentTerm;

var dueDate = clock.UtcNow.Add(paymentTerm);

var requiresReview =
    encounter.Charges.Any(
        charge => charge.Amount > reviewThreshold);

return new SubmissionRequest
{
    EncounterId = encounter.Id,
    Amount = outstandingBalance,
    DueDate = dueDate,
    RequiresReview = requiresReview
};
```

#### Rule

Keep object initialization declarative.

Move nontrivial calculations, queries, and business decisions into named values before the initializer.

Simple property mappings should remain inline:

```csharp
return new EncounterResponse
{
    Id = encounter.Id,
    Status = encounter.Status,
    CustomerId = encounter.CustomerId
};
```


### Separate querying from decision-making

Avoid:

```csharp
if (await repository.GetClaimsAsync(
        encounter.Id,
        cancellationToken) is { Count: > 0 } claims
    && claims.All(
        claim => claim.Status == ClaimStatus.Processed)
    && claims.Sum(
        claim => claim.PaidAmount) >= encounter.TotalCharges)
{
    encounter.MarkPaid();
}
```

Prefer:

```csharp
var claims = await repository.GetClaimsAsync(
    encounter.Id,
    cancellationToken);

if (claims.Count == 0)
{
    return;
}

var allClaimsAreProcessed =
    claims.All(
        claim => claim.Status == ClaimStatus.Processed);

var totalPaidAmount =
    claims.Sum(claim => claim.PaidAmount);

var balanceIsSatisfied =
    totalPaidAmount >= encounter.TotalCharges;

if (!allClaimsAreProcessed || !balanceIsSatisfied)
{
    return;
}

encounter.MarkPaid();
```

#### Rule

Do not combine asynchronous retrieval, collection analysis, business decisions, and mutation into one condition.

Make the stages visible when they represent separate concepts.


### Separate meaningful transformation stages

Avoid when several distinct normalization decisions are hidden:

```csharp
var normalizedPayorName = payor.Name
    .Trim()
    .ToUpperInvariant()
    .Replace("-", string.Empty)
    .Replace(" ", string.Empty);
```

Prefer when the stages are meaningful:

```csharp
var trimmedPayorName =
    payor.Name.Trim();

var normalizedCasing =
    trimmedPayorName.ToUpperInvariant();

var normalizedPayorName = normalizedCasing
    .Replace("-", string.Empty)
    .Replace(" ", string.Empty);
```

Prefer a method when the transformation is cohesive and reused:

```csharp
var normalizedPayorName =
    NormalizePayorName(payor.Name);
```

#### Rule

Extract transformation stages when they:

* represent distinct concepts;
* require independent validation;
* are reused;
* benefit from focused testing;
* are useful debugging checkpoints.

Do not break apart fluent code merely because it spans multiple lines.


## Control Flow

### Prefer guard clauses for exceptional or non-applicable paths

Avoid:

```csharp
if (encounter is not null)
{
    if (encounter.Status == EncounterStatus.Approved)
    {
        if (encounter.Balance > 0)
        {
            await SubmitAsync(
                encounter,
                cancellationToken);
        }
    }
}
```

Prefer:

```csharp
if (encounter is null)
{
    return;
}

if (encounter.Status != EncounterStatus.Approved)
{
    return;
}

if (encounter.Balance <= 0)
{
    return;
}

await SubmitAsync(encounter, cancellationToken);
```

#### Rule

Use guard clauses when they remove nesting and make the successful path easier to follow.


### Do not force guard clauses when the alternatives are symmetrical

Avoid turning a simple binary decision into scattered returns:

```csharp
if (encounter.IsEmergency)
{
    await RouteToEmergencyQueueAsync(
        encounter,
        cancellationToken);

    return;
}

await RouteToStandardQueueAsync(
    encounter,
    cancellationToken);
```

A conventional `if/else` may communicate the choice more directly:

```csharp
if (encounter.IsEmergency)
{
    await RouteToEmergencyQueueAsync(
        encounter,
        cancellationToken);
}
else
{
    await RouteToStandardQueueAsync(
        encounter,
        cancellationToken);
}
```

#### Rule

Use guard clauses for invalid, exceptional, or non-applicable paths.

Use branching when multiple paths are equally valid alternatives.


### Avoid deep nesting

Treat nesting beyond two meaningful levels as a review signal.

Deep nesting often indicates:

* missing guard clauses;
* multiple responsibilities;
* an unnamed domain decision;
* a missing extraction;
* unnecessary loops within loops;
* combined validation and execution.

Do not extract code solely to satisfy a numerical nesting limit. Extract cohesive behavior.


### Keep the primary path visible

Prefer ordering methods as:

1. validation or guards;
2. retrieval;
3. decision-making;
4. mutation;
5. persistence;
6. external communication;
7. result construction.

Example:

```csharp
public async Task<Result> HandleAsync(
    SubmitEncounterCommand command,
    CancellationToken cancellationToken)
{
    var encounter = await encounterRepository.GetAsync(
        command.EncounterId,
        cancellationToken);

    if (encounter is null)
    {
        return Result.NotFound();
    }

    if (!encounter.CanBeSubmitted())
    {
        return Result.Invalid(
            "The encounter is not eligible for submission.");
    }

    encounter.MarkSubmitted(clock.UtcNow);

    await encounterRepository.SaveChangesAsync(
        cancellationToken);

    await submissionPublisher.PublishAsync(
        encounter.Id,
        cancellationToken);

    return Result.Success();
}
```

The reader should be able to follow the method from top to bottom without repeatedly jumping between levels of abstraction.


### Avoid assignment inside conditions

Avoid:

```csharp
if ((encounter = await repository.GetAsync(
        encounterId,
        cancellationToken)) is not null)
{
    await ProcessAsync(encounter, cancellationToken);
}
```

Prefer:

```csharp
var encounter = await repository.GetAsync(
    encounterId,
    cancellationToken);

if (encounter is null)
{
    return;
}

await ProcessAsync(encounter, cancellationToken);
```

#### Rule

Keep retrieval and conditional decisions separate when combining them obscures control flow.


## Methods and Responsibilities

### Keep methods conceptually focused

A method should have one coherent purpose at its current abstraction level.

Review methods that simultaneously:

* validate input;
* load several aggregates;
* calculate business decisions;
* mutate entities;
* save data;
* publish messages;
* send email;
* build HTTP responses.

This does not mean every operation requires its own method.

Extract code when the extracted method represents a meaningful operation.


### Extract cohesive operations, not arbitrary line ranges

Avoid:

```csharp
private static bool CheckThing(
    Encounter encounter,
    DateTime utcNow)
{
    return encounter.Status == EncounterStatus.Approved
        && encounter.Balance > 0
        && utcNow - encounter.LastSubmittedAt > SubmissionDelay;
}
```

`CheckThing` hides logic behind a weak name.

Prefer:

```csharp
private static bool IsEligibleForSubmission(
    Encounter encounter,
    DateTime utcNow)
{
    var isApproved =
        encounter.Status == EncounterStatus.Approved;

    var hasOutstandingBalance =
        encounter.Balance > 0;

    var submissionDelayHasElapsed =
        utcNow - encounter.LastSubmittedAt > SubmissionDelay;

    return isApproved
        && hasOutstandingBalance
        && submissionDelayHasElapsed;
}
```

#### Rule

An extracted method must have a name that communicates a meaningful responsibility or decision.


### Avoid excessive fragmentation

Do not transform a locally understandable sequence into many one-line methods:

```csharp
ValidateEncounter(encounter);
CalculateBalance(encounter);
UpdateStatus(encounter);
SaveEncounter(encounter);
```

when each method merely contains one obvious statement and understanding the flow requires repeatedly navigating elsewhere.

#### Rule

Extraction should reduce cognitive load, not merely reduce method length.

Keep tightly related operations together when their locality makes the behavior easier to understand.


### Keep methods at a consistent abstraction level

Avoid:

```csharp
public async Task ProcessAsync(
    Encounter encounter,
    CancellationToken cancellationToken)
{
    ValidateEncounter(encounter);

    encounter.Status = EncounterStatus.Processed;
    encounter.ProcessedAt = clock.UtcNow;
    encounter.ModifiedBy = currentUser.Id;

    await notificationService.SendProcessedNotificationAsync(
        encounter.Customer.Email,
        encounter.Id,
        cancellationToken);
}
```

This mixes:

* high-level validation;
* low-level entity field assignments;
* high-level notification behavior.

Prefer:

```csharp
public async Task ProcessAsync(
    Encounter encounter,
    CancellationToken cancellationToken)
{
    ValidateEncounter(encounter);

    encounter.MarkProcessed(
        clock.UtcNow,
        currentUser.Id);

    await NotifyCustomerAsync(
        encounter,
        cancellationToken);
}
```

#### Rule

A method should generally describe its behavior at one conceptual level.


### Limit parameter complexity

Review methods with:

* more than four or five parameters;
* multiple booleans;
* several primitive values belonging to one concept;
* parameters that are always passed together;
* parameters that materially alter the method’s responsibility.

Avoid:

```csharp
await UpdateEncounterAsync(
    encounter.Id,
    true,
    false,
    5,
    "Insurance received",
    cancellationToken);
```

Prefer named arguments for a small existing API:

```csharp
await UpdateEncounterAsync(
    encounterId: encounter.Id,
    pauseInvoicing: true,
    notifyCustomer: false,
    pauseDurationInDays: 5,
    reason: "Insurance received",
    cancellationToken);
```

Prefer a request object when the values form one cohesive operation:

```csharp
var updateRequest = new EncounterUpdateRequest
{
    EncounterId = encounter.Id,
    PauseInvoicing = true,
    NotifyCustomer = false,
    PauseDuration = TimeSpan.FromDays(5),
    Reason = "Insurance received"
};

await UpdateEncounterAsync(
    updateRequest,
    cancellationToken);
```

#### Rule

Do not make callers memorize the positional meaning of several primitive arguments.


### Avoid boolean parameters that switch responsibilities

Avoid:

```csharp
await ProcessEncounterAsync(
    encounter,
    sendNotification: true,
    cancellationToken);
```

when the flag produces substantially different behavior.

Prefer explicit operations:

```csharp
await ProcessEncounterAsync(
    encounter,
    cancellationToken);

await SendProcessedNotificationAsync(
    encounter,
    cancellationToken);
```

Or separate named methods when the two variants are valid cohesive operations.

#### Rule

A boolean parameter is a review signal when it changes what the method fundamentally does.


## Classes and Design

### Give each class a cohesive responsibility

A class should group behavior that changes for related reasons.

Review classes that combine:

* data access;
* domain calculation;
* HTTP concerns;
* serialization;
* message publishing;
* caching;
* validation;
* configuration resolution.

Do not split a class merely because it has several methods. Split when the responsibilities have different reasons to change.


### Avoid vague service classes

Avoid expanding a generic service indefinitely:

```csharp
public sealed class EncounterService
{
    public Task ApproveAsync(...);
    public Task SubmitAsync(...);
    public Task CalculateChargesAsync(...);
    public Task SendEmailAsync(...);
    public Task CreateInvoiceAsync(...);
    public Task ExportAsync(...);
}
```

Prefer cohesive components when the responsibilities are independently meaningful:

```text
EncounterApprovalService
EncounterSubmissionService
EncounterChargeCalculator
InvoiceExporter
```

Do not split when doing so would create several trivial classes with no independent responsibility.


### Do not create interfaces automatically

Avoid:

```csharp
public interface IEncounterNameFormatter
{
    string Format(Encounter encounter);
}

public sealed class EncounterNameFormatter
    : IEncounterNameFormatter
{
    public string Format(Encounter encounter)
    {
        return $"{encounter.LastName}, {encounter.FirstName}";
    }
}
```

when:

* there is only one implementation;
* no architectural boundary exists;
* no alternate implementation is expected;
* the behavior is deterministic;
* testing does not require substitution;
* the repository does not use interfaces for this type of component.

#### Create an interface when it represents:

* an external system boundary;
* an application-owned persistence contract;
* time, randomness, environment, or identity;
* multiple valid implementations;
* a meaningful test seam;
* a dependency inversion boundary;
* a plugin or strategy point that is actually required.

#### Rule

Interfaces represent boundaries or substitutable behavior, not classes.


### Avoid redundant interface inheritance declarations

Do not list both a derived interface and an interface it already inherits.

Avoid:

```csharp
public sealed class BillingRule
    : IBillingRuleV2, IMultiTriggerBillingRuleV2
{
}
```

when `IMultiTriggerBillingRuleV2` already implements `IBillingRuleV2`.

Prefer:

```csharp
public sealed class BillingRule
    : IMultiTriggerBillingRuleV2
{
}
```

#### Rule

Declare only the most specific interfaces needed to express the type's contracts. Keep a redundant base interface only when a verified framework, source generator, or repository convention requires the explicit declaration.


### Avoid speculative abstractions

Do not add:

* factories;
* strategies;
* builders;
* generic repositories;
* base handlers;
* pipeline frameworks;
* generic wrappers;
* extensibility points;

because they might be useful later.

Add abstractions to solve an existing, concrete design problem.

Prefer a direct implementation until the variation is real and understood.


### Prefer composition over inheritance

Avoid base classes that exist mainly to share incidental code:

```csharp
public abstract class BaseEncounterHandler
{
    protected void LogStart(...)
    {
    }

    protected void Validate(...)
    {
    }
}
```

Prefer:

* injected collaborators;
* cohesive helper services;
* extension methods for genuinely general behavior;
* local private methods;
* shared domain objects.

Use inheritance when the relationship is genuinely substitutable and central to the model.


### Keep dependencies explicit

Required dependencies should normally be visible through constructor injection.

Avoid service location:

```csharp
public async Task HandleAsync(
    IServiceProvider serviceProvider,
    CancellationToken cancellationToken)
{
    var repository =
        serviceProvider.GetRequiredService<IEncounterRepository>();

    await repository.SaveChangesAsync(cancellationToken);
}
```

Prefer:

```csharp
public sealed class EncounterHandler(
    IEncounterRepository encounterRepository)
{
    public Task HandleAsync(
        CancellationToken cancellationToken)
    {
        return encounterRepository.SaveChangesAsync(
            cancellationToken);
    }
}
```

#### Rule

Business code must not resolve its own dependencies from the container.


## State and Static Usage

### Mark stateless members static

A private or internal member that does not access instance state should normally be `static`.

Avoid:

```csharp
private Task<Result> ExecuteAsync(Request request)
{
    return ExecuteCoreAsync(request);
}
```

when the method uses no instance fields, properties, or virtual dispatch.

Prefer:

```csharp
private static Task<Result> ExecuteAsync(Request request)
{
    return ExecuteCoreAsync(request);
}
```

This makes the lack of instance coupling explicit and prevents accidental access to object state later.

Do not force `static` onto interface implementations, overrides, framework-discovered members, or methods that intentionally rely on instance polymorphism or repository conventions.

#### Rule

Mark members `static` when they do not access instance data and no framework or design constraint requires an instance member.


### Prohibit mutable global application state

Avoid:

```csharp
public static class ApplicationState
{
    public static CurrentUser CurrentUser { get; set; }

    public static IServiceProvider Services { get; set; }

    public static Dictionary<string, object> Cache { get; } =
        new();
}
```

Problems include:

* hidden dependencies;
* cross-test interference;
* concurrency hazards;
* unclear ownership;
* difficult lifecycle management;
* unpredictable mutation.

#### Rule

Do not introduce mutable static application state.


### Acceptable static usage

Static constructs may be appropriate for:

* compile-time constants;
* immutable values;
* deterministic pure functions;
* extension methods;
* stateless mapping;
* cohesive constants scoped to an owning concept.

Example:

```csharp
public sealed class BillingRuleProcessor
{
    private static readonly TimeSpan RetryWindow =
        TimeSpan.FromDays(5);
}
```

Prefer narrow ownership over broad global constant classes.


### Singleton services must be safe

A singleton service must be:

* stateless; or
* immutable after construction; or
* explicitly thread-safe.

Do not inject scoped services into singleton services.

Do not store request-specific, user-specific, or operation-specific values in singleton fields.


### Make ambient dependencies explicit

Time-dependent code should not directly call `DateTime.UtcNow` throughout business logic when deterministic testing matters.

Avoid:

```csharp
encounter.MarkProcessed(DateTime.UtcNow);
```

Prefer the repository’s existing time abstraction:

```csharp
encounter.MarkProcessed(clock.UtcNow);
```

Apply similar treatment to:

* GUID generation;
* randomness;
* current user;
* environment state;
* filesystem;
* network calls;
* external APIs.

Do not introduce wrappers around stable framework operations unless the abstraction provides meaningful value.


## Abstraction and Duplication

### Apply DRY to knowledge, not merely text

Two blocks of similar code are not necessarily the same abstraction.

Do not consolidate code merely because it looks similar.

Before extracting shared logic, determine whether both callers represent the same business rule and should change together.

Avoid forcing unrelated concepts into one configurable method:

```csharp
private Task ProcessAsync(
    Encounter encounter,
    bool isInsurance,
    bool createInvoice,
    bool publishMessage,
    CancellationToken cancellationToken)
{
    // Many conditional branches.
}
```

Prefer separate cohesive operations when the workflows have different business meaning.


### Allow small duplication when it preserves clarity

Two short, obvious blocks may be preferable to:

* a generic helper with flags;
* a shared base class;
* a complicated strategy hierarchy;
* a generic method with multiple type parameters;
* an abstraction whose name is less clear than the duplicated code.

#### Rule

Remove duplication when it represents duplicated knowledge or creates a real maintenance hazard.

Do not remove duplication at the expense of comprehension or cohesion.


### Avoid unnecessary wrapper methods

Avoid:

```csharp
private Task SaveAsync(
    CancellationToken cancellationToken)
{
    return encounterRepository.SaveChangesAsync(
        cancellationToken);
}
```

when the wrapper adds no meaning, policy, coordination, or abstraction.

Prefer calling the dependency directly.

A wrapper is useful when it:

* communicates a domain operation;
* coordinates several steps;
* applies policy;
* hides an implementation detail that should remain private;
* creates a meaningful seam.


## Comments

### Explain why, not what

Avoid:

```csharp
// Check whether the encounter is approved.
if (encounter.Status == EncounterStatus.Approved)
{
    // Submit the encounter.
    await SubmitAsync(encounter, cancellationToken);
}
```

Prefer no comment when the code already communicates the behavior.

Use comments for:

* non-obvious business rationale;
* external-system limitations;
* ordering constraints;
* intentionally unusual behavior;
* performance tradeoffs;
* compatibility requirements;
* decisions that appear incorrect without historical context.

Example:

```csharp
// Insurance messages can arrive more than once. Keep this operation
// idempotent because EMSafe retries when the acknowledgement times out.
if (encounter.HasProcessedInsuranceMessage(message.Id))
{
    return;
}
```


### Do not preserve implementation history in comments

Avoid:

```csharp
// Changed this from Any() because it caused a bug last month.
```

The version-control history already records implementation changes.

Document the current constraint instead:

```csharp
// The database can contain duplicate legacy rows, so the newest
// active setting must be selected explicitly.
```


### Treat explanatory comments as a refactoring signal

When a comment explains what several lines do, first determine whether:

* a better variable name;
* an extracted method;
* a domain method;
* a type;
* clearer control flow;

would communicate the same information more reliably.

Do not remove useful rationale comments merely to make code “self-documenting.”


## Null Handling and Validation

### Validate at the correct boundary

Validate external or untrusted input at system boundaries:

* HTTP requests;
* queue messages;
* files;
* configuration;
* database data with uncertain integrity;
* third-party API responses.

Do not repeat the same validation at every internal layer unless each layer independently requires the guarantee.


### Avoid defensive checks for impossible internal states

Do not add arbitrary null handling when nullable annotations and established invariants guarantee a value exists.

Avoid:

```csharp
var providerName =
    encounter.Provider?.Name ?? string.Empty;
```

when a missing provider represents corrupted state and silently continuing would produce incorrect behavior.

Prefer enforcing or exposing the invariant:

```csharp
var provider = encounter.Provider
    ?? throw new InvalidOperationException(
        "An encounter must have a provider before submission.");
```

Use repository-specific exception and result conventions.

#### Rule

Do not convert invalid states into plausible but incorrect default values.


### Do not use exceptions for expected branching

Avoid exceptions for normal business outcomes such as:

* not found;
* not eligible;
* already processed;
* validation failure;

when the repository uses results or explicit return values for those cases.

Use exceptions for exceptional failures and broken invariants according to repository convention.


## Collections and LINQ

### Prefer readable LINQ

LINQ should make collection intent clearer than an equivalent loop.

Avoid dense pipelines that combine filtering, grouping, mutation, and projection:

```csharp
var results = encounters
    .Where(x => x.Status == EncounterStatus.Approved)
    .GroupBy(x => x.CustomerId)
    .SelectMany(g => g.OrderByDescending(x => x.CreatedAt).Take(1))
    .Select(x =>
    {
        x.MarkSelected();
        return mapper.Map<Result>(x);
    })
    .ToList();
```

Prefer separating stages and avoiding mutation inside projections:

```csharp
var approvedEncounters = encounters
    .Where(encounter =>
        encounter.Status == EncounterStatus.Approved);

var newestEncounterByCustomer = approvedEncounters
    .GroupBy(encounter => encounter.CustomerId)
    .Select(group => group.MaxBy(
        encounter => encounter.CreatedAt))
    .WhereNotNull()
    .ToList();

foreach (var encounter in newestEncounterByCustomer)
{
    encounter.MarkSelected();
}

var results = newestEncounterByCustomer
    .Select(MapResult)
    .ToList();
```

Use only extension methods already available or appropriate for the repository.


### Avoid repeated enumeration

Review code that enumerates the same `IEnumerable<T>` multiple times, especially when the source may be:

* an EF Core query;
* a generator;
* an API-backed sequence;
* computationally expensive.

Avoid:

```csharp
if (encounters.Any())
{
    var totalBalance =
        encounters.Sum(encounter => encounter.Balance);
}
```

when enumeration cost or stability matters.

Prefer materializing once when appropriate:

```csharp
var encounterList = encounters.ToList();

if (encounterList.Count == 0)
{
    return;
}

var totalBalance =
    encounterList.Sum(encounter => encounter.Balance);
```

Do not materialize automatically when streaming is intentional or the sequence is already a collection.


### Avoid hidden mutation in LINQ

Do not use LINQ primarily for side effects:

```csharp
encounters
    .Where(encounter => encounter.IsEligible)
    .ToList()
    .ForEach(encounter => encounter.MarkProcessed());
```

Prefer:

```csharp
var eligibleEncounters = encounters
    .Where(encounter => encounter.IsEligible);

foreach (var encounter in eligibleEncounters)
{
    encounter.MarkProcessed();
}
```

#### Rule

Use LINQ for querying and transformation. Use loops for visible mutation and side effects.


## Async Code

### Propagate cancellation tokens

Pass `CancellationToken` through:

* database calls;
* HTTP calls;
* message publishing;
* file operations;
* long-running loops;
* framework APIs that support cancellation.

Avoid replacing a provided token with `CancellationToken.None`.

Do not add cancellation parameters to trivial synchronous methods.


### Avoid unnecessary async wrappers

Avoid:

```csharp
public async Task<Encounter?> GetAsync(
    Guid encounterId,
    CancellationToken cancellationToken)
{
    return await repository.GetAsync(
        encounterId,
        cancellationToken);
}
```

Prefer:

```csharp
public Task<Encounter?> GetAsync(
    Guid encounterId,
    CancellationToken cancellationToken)
{
    return repository.GetAsync(
        encounterId,
        cancellationToken);
}
```

Keep `async` when needed for:

* multiple awaited operations;
* `try/catch/finally` around awaited work;
* `await using`;
* post-await processing;
* clearer exception behavior.

Follow repository conventions regarding direct task returns.


### Do not use fire-and-forget tasks accidentally

Avoid:

```csharp
notificationService.SendAsync(
    notification,
    cancellationToken);
```

when the returned task is ignored unintentionally.

Await the operation or use an explicit background-work mechanism.

Fire-and-forget behavior must be deliberate, observable, and owned by infrastructure designed for it.


### Avoid unnecessary concurrency

Do not introduce `Task.WhenAll`, parallel loops, or background tasks without considering:

* shared `DbContext` safety;
* ordering requirements;
* rate limits;
* transaction boundaries;
* resource pressure;
* exception aggregation;
* cancellation;
* deterministic behavior.

Concurrency is an architectural and performance decision, not a cosmetic optimization.


## EF Core and Data Access

### Keep query intent visible

Prefer readable query stages when a query contains several independent concepts.

Avoid:

```csharp
var encounters = await dbContext.Encounters
    .Where(x => x.Status == EncounterStatus.Approved
        && !x.IsDeleted
        && x.Customer.IsActive
        && x.Claims.All(c => c.Status != ClaimStatus.Pending)
        && x.LastSubmittedAt < cutoff)
    .OrderBy(x => x.LastSubmittedAt)
    .Take(batchSize)
    .ToListAsync(cancellationToken);
```

Prefer:

```csharp
var eligibleEncounters = dbContext.Encounters
    .Where(encounter => !encounter.IsDeleted)
    .Where(encounter =>
        encounter.Status == EncounterStatus.Approved)
    .Where(encounter =>
        encounter.Customer.IsActive)
    .Where(encounter =>
        encounter.Claims.All(
            claim => claim.Status != ClaimStatus.Pending))
    .Where(encounter =>
        encounter.LastSubmittedAt < cutoff);

var encounters = await eligibleEncounters
    .OrderBy(encounter => encounter.LastSubmittedAt)
    .Take(batchSize)
    .ToListAsync(cancellationToken);
```

This is preferable when each predicate represents an independent business eligibility condition.

Do not mechanically split every query predicate when the combined condition is short and cohesive.


### Avoid loading unnecessary data

Do not load full entities when only a projection is required.

Avoid:

```csharp
var encounters = await dbContext.Encounters
    .ToListAsync(cancellationToken);

var encounterIds = encounters
    .Select(encounter => encounter.Id)
    .ToList();
```

Prefer:

```csharp
var encounterIds = await dbContext.Encounters
    .Select(encounter => encounter.Id)
    .ToListAsync(cancellationToken);
```


### Avoid client-side evaluation and hidden query explosion

Review:

* `ToList` before filtering;
* loops that issue one query per item;
* navigation access that triggers unexpected loading;
* repeated `FirstOrDefaultAsync` calls;
* large `Include` graphs;
* projections that retrieve unused columns;
* queries that cannot be translated.

Do not “optimize” queries without confirming semantic equivalence.


### Keep persistence concerns out of domain behavior

Domain entities should not ordinarily:

* receive a `DbContext`;
* execute queries;
* call repositories;
* publish messages;
* depend on ASP.NET;
* depend on EF Core APIs.

Domain behavior should operate on state already owned by the aggregate or explicitly provided values.

Follow the repository’s actual architecture when the project intentionally uses a different model.


## Logging

### Log meaningful events

Logs should help operators understand:

* what happened;
* which entity or operation was affected;
* why an operation was skipped or failed;
* which external dependency failed;
* whether retry is expected.

Prefer structured logging:

```csharp
logger.LogInformation(
    "Skipping encounter {EncounterId} because it was already processed",
    encounter.Id);
```

Avoid interpolation:

```csharp
logger.LogInformation(
    $"Skipping encounter {encounter.Id}");
```


### Avoid noisy logs

Do not log every internal method entry and exit.

Do not log the same exception at several layers unless each layer adds distinct operational context.

Do not log sensitive or regulated data.

Use repository conventions for log levels.


## Error Handling

### Preserve useful exception context

Avoid:

```csharp
catch (Exception)
{
    throw new Exception("Processing failed.");
}
```

Prefer allowing the original exception to propagate or wrapping it with meaningful context and an inner exception:

```csharp
catch (ExternalPayorException exception)
{
    throw new EncounterSubmissionException(
        encounter.Id,
        "The payor submission failed.",
        exception);
}
```

Use repository-specific exception conventions.


### Catch exceptions only when the method can respond meaningfully

Valid reasons include:

* translating an infrastructure exception at a boundary;
* adding meaningful context;
* applying a retry policy;
* performing cleanup;
* converting to an established result type;
* handling a known expected condition.

Do not catch exceptions merely to log and rethrow unless the log adds unique context.


## Tests

### Match repository test structure

Use existing conventions for:

* test naming;
* fixture setup;
* builders;
* mocks;
* assertions;
* test data;
* integration-test infrastructure;
* database cleanup.

Do not introduce a new assertion library, mocking framework, or fixture pattern for one implementation.


### Test behavior, not implementation details

Prefer:

```csharp
[Fact]
public async Task HandleAsync_marks_eligible_encounter_as_submitted()
{
    // Arrange

    // Act

    // Assert
}
```

Avoid tests whose primary purpose is verifying private method structure, exact internal call order, or incidental implementation details unless order is part of the behavior.


### Keep tests readable

Use meaningful setup variables:

```csharp
var approvedEncounter =
    EncounterBuilder.Create()
        .WithStatus(EncounterStatus.Approved)
        .WithOutstandingBalance(100m)
        .Build();
```

Avoid large undifferentiated setup blocks with unexplained values.

Name expected values when they communicate the scenario:

```csharp
var expectedPauseExpiration =
    currentTime.AddDays(5);
```


### Test boundaries and decisions

For business decisions, include cases for:

* eligible state;
* each independent ineligible condition;
* boundary timestamps;
* empty collections;
* duplicate messages;
* invalid state;
* cancellation when relevant;
* external dependency failures when behavior differs.

Do not add redundant tests that exercise the same path with cosmetically different data.


## Comments on Common Clean-Code Rules

### DRY is not absolute

Do not consolidate code solely because two blocks look similar.

Consolidate when they represent the same knowledge and should change together.


### Small methods are not automatically better

A short method can still be poorly named, fragmented, or conceptually unclear.

A somewhat longer cohesive method can be easier to understand than several tiny methods spread throughout a class.


### SOLID is guidance, not a class-count target

Do not create an interface, factory, strategy, and implementation for every behavior.

Use SOLID principles to reduce coupling and clarify responsibilities, not to maximize abstraction.


### Comments are not inherently bad

Comments that explain constraints and rationale are valuable.

Comments that repeat syntax are noise.


### Self-documenting code has limits

Code can explain mechanics and intent.

Code cannot always explain:

* regulatory requirements;
* historical data anomalies;
* third-party limitations;
* unusual compatibility constraints;
* deliberately accepted tradeoffs.

Document those constraints explicitly.


### KISS does not mean minimum lines

Simple code minimizes conceptual burden.

A few well-named intermediate variables may be simpler than one compact expression.
