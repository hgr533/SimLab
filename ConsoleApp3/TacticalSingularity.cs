using System;
using System.Collections.Generic;
using System.Text;
using System.Linq;

namespace ConsoleApp3
{
    public class TacticalSingularity : Neuron
    {
        // The "Messi" Constant: High density, high spin
        private const double MetabolicMass = 10.0;
        private const double SpinParameterA = 0.99; // Near-maximum Kerr rotation
        private const double ErgosphereRadius = 5.0; // Yards

        public void ApplySingularity(List<Agent> defenders)
        {
            foreach (var defender in defenders)
            {
                double distance = CalculateDistance(defender);

                if (distance <= ErgosphereRadius)
                {
                    // 1. Frame Dragging: The defender's 'intent' is pulled 
                    // toward the Singularity's vector.
                    ApplyFrameDragging(defender, distance);

                    // 2. Wave Function Collapse: 
                    // The defender's 16D Bayesian state is crushed into 1D (Freeze).
                    CollapseProbability(defender);

                    // 3. Octonionic Breakdown: 
                    // The defender loses "Associativity" - they can no longer 
                    // coordinate with the rest of the defensive line.
                    BreakAssociativity(defender);
                }
            }
        }

        private void ApplyFrameDragging(Agent defender, double r)
        {
            // Math: Omega = (2 * M * a * r) / (r^4 + r^2 * a^2 + 2 * M * a^2)
            double angularVelocity = (2 * MetabolicMass * SpinParameterA * r) /
                                     (Math.Pow(r, 4) + Math.Pow(r, 2) * Math.Pow(SpinParameterA, 2));

            // The defender's velocity vector is forced to rotate with Messi
            defender.VelocityVector += this.RotationVector * angularVelocity;
        }

        private void CollapseProbability(Agent defender)
        {
            // The defender enters a 'Schrödinger's Cat' state where they 
            // think they have the ball and don't simultaneously.
            // We force the collapse to "Missed Tackle".
            defender.BayesianState.Prior = 0.000001;
            defender.ActionPotential = 0.0; // Inhibition
        }
    }
}

