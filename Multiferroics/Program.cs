using Multiferroics;
using System;
using System.Collections.Generic;
using System.Numerics;
using static System.Net.WebRequestMethods;
using static System.Runtime.InteropServices.JavaScript.JSType;

// Example usage
public class Program
{
    public static void Main()
    {
        Console.WriteLine("=== Multiferroic Material Optimization Examples ===\n");

        // Example 1: Sensor application
        Console.WriteLine("1. Sensor Application:");
        var sensorOptimizer = new MultiferroicOptimizer(ApplicationType.Sensor);
        sensorOptimizer.OptimizeForApplication();

        Console.WriteLine("\n2. Actuator Application:");
        var actuatorOptimizer = new MultiferroicOptimizer(ApplicationType.Actuator);
        actuatorOptimizer.OptimizeForApplication();

        // Example 3: Custom configuration
        Console.WriteLine("\n3. Custom Configuration:");
        var customConfig = new MaterialConfig
        {
            InitialPolarization = 0.15,
            CouplingStrength = 3e-8,
            ElectricFieldAmplitude = 2e3,
            SpatialFrequency = 0.15,
            TemporalFrequency = 0.08
        };
        var customOptimizer = new MultiferroicOptimizer(customConfig);
        customOptimizer.OptimizeForApplication();

        // Example 4: Application switching
        Console.WriteLine("\n4. Application Switching:");
        var adaptiveOptimizer = new MultiferroicOptimizer(ApplicationType.Memory);
        adaptiveOptimizer.OptimizeForApplication();
        adaptiveOptimizer.AdaptToNewApplication(ApplicationType.EnergyHarvesting);
        adaptiveOptimizer.OptimizeForApplication();

        // Example 5: Application with custom tweaks
        Console.WriteLine("\n5. Sensor with Custom Tweaks:");
        var tweakedSensor = MaterialFactory.CreateMaterial(ApplicationType.Sensor, config =>
        {
            config.CouplingStrength *= 2.0;  // Double the coupling
            config.SpatialFrequency = 0.5;   // Higher spatial resolution
        });

        var tweakedOptimizer = new MultiferroicOptimizer(ApplicationType.Custom);
        tweakedOptimizer.OptimizeForApplication();
    }

    //What I changed and why
    //Added a proper copy constructor `MaterialConfig(MaterialConfig other)` and a `Clone()` method.This fixes compile errors where code called `new MaterialConfig(existingConfig)` (the factory previously assumed such a constructor existed).
    //Fixed a typo: `TemporalFreequency` -> `TemporalFrequency` in the `EnergyHarvesting` default configuration.That resolved the "'MaterialConfig' does not contain a definition for 'TemporalFreequency'" error.
    //Replaced the invalid extension-like method name with a proper extension helper `CopyFrom(this MaterialConfig source, MaterialConfig other)`. The previous method used the type name as the method name and caused multiple syntax/semantic errors.
    //Kept the factory usage `new MaterialConfig(existingConfig)` (now valid) and adjusted other code that relied on copying configuration.
    //Added `using Multiferroics;` to `Program.cs` so `Program` can resolve `MaterialConfig`, `MaterialFactory`, `ApplicationType`, and `MultiferroicOptimizer`.
    //Notes about the NuGet / ResolvePackageAssets error
    //The build-time error about `ResolvePackageAssets` and the missing fallback package folder is an environment/Visual Studio configuration issue (the folder 'E:\Program Files (x86)\Microsoft Visual Studio\Shared\NuGetPackages' does not exist). Two quick remediation options:
    //Create the missing folder path or update your NuGet fallback folders so the path is valid.
    //Update your NuGet configuration or environment to point to a valid packages folder (set the __NUGET_PACKAGES__ environment variable or adjust the machine/user nuget.config), then run __dotnet restore__ or use __Build > Restore NuGet Packages__ in Visual Studio.
    //The code fixes above remove the C# compile errors; the NuGet error must be fixed separately in the environment.
    //-gitcopilot
}