import numpy as np
import cupy as cp
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import os, tempfile, csv, time, sys

# Check for cupy availability
try:
    import cupy as cp
    GPU_AVAILABLE = True
except Exception as e:
    print(f"GPU not available: {e}")
    cp = None
    GPU_AVAILABLE = False

def transition_energy_per_neuron(prev, curr, dynamic=False, energy_scale=1.0):
    energy_map = {}
    for a in [-1, 0, 1]:
        for b in [-1, 0, 1]:
            if a == b:
                energy_map[(a, b)] = 0.1 * energy_scale
            elif a == 0 or b == 0:
                energy_map[(a, b)] = 1.0 * energy_scale
            else:
                energy_map[(a, b)] = 5.0 * energy_scale
    prev = np.array(prev, dtype=int).flatten()
    curr = np.array(curr, dtype=int).flatten()
    energies = [energy_map[(int(p), int(c))] for p, c in zip(prev, curr)]
    if dynamic:
        # Simulate dynamic energy based on transition magnitude
        energies = [e * abs(p - c) for e, p, c in zip(energies, prev, curr)]
    return energies

def to_ternary_array(x, t_low=-0.5, t_high=0.5):
    """Convert continuous values to ternary (-1, 0, +1) based on thresholds."""
    x = np.array(x)
    return np.where(x >= t_high, 1, np.where(x <= t_low, -1, 0))

def ternary_layer_numpy(inputs, weights, biases=None, add_noise=False, sigma=0.05, t_low=-0.5, t_high=0.5,
                        mode="ternary"):
    """
    Vectorized layer computation for ternary or bipolar logic.

    Args:
        inputs: Input vector (numpy array of -1, 0, +1 or continuous values)
        weights: 2D array (num_neurons x num_inputs) of weights (-1, 0, +1)
        biases: 1D array of biases (optional, defaults to zeros)
        add_noise: Whether to add Gaussian noise (default False)
        sigma: Standard deviation of noise (default 0.05)
        t_low: Lower threshold for ternary mapping (default -0.5)
        t_high: Upper threshold for ternary mapping (default 0.5)
        mode: "ternary" or "bipolar" (default "ternary")

    Returns:
        numpy array of layer outputs (-1, 0, +1 for ternary; -1, 0, +1 for bipolar)
    """
    # Input validation and initialization
    inputs = np.array(inputs, dtype=float)
    weights = np.array(weights, dtype=float)
    if biases is None:
        biases = np.zeros(weights.shape[0], dtype=float)
    else:
        biases = np.array(biases, dtype=float)

    # Apply noise if requested
    inputs_copy = inputs.copy()
    weights_copy = weights.copy()
    if add_noise:
        weights_copy += np.random.normal(0, sigma, size=weights_copy.shape)
        inputs_copy += np.random.normal(0, sigma, size=inputs_copy.shape)

    # Vectorized dot product
    result = np.dot(weights_copy, inputs_copy) + biases

    # Apply activation based on mode
    if mode == "bipolar":
        # Bipolar: Map to -1 or +1, 0 as neutral
        outputs = np.sign(result)
        outputs[result == 0] = 0  # Ensure 0 stays neutral
    else:  # ternary
        # Ternary: Map to -1, 0, +1 based on thresholds
        outputs = to_ternary_array(result, t_low, t_high)

    return outputs

# Example usage and integration with existing framework
if __name__ == "__main__":
    # Sample data
    np.random.seed(123)
    input_vector = np.random.choice([-1, 0, 1], size=4, p=[0.3, 0.4, 0.3])
    weights = np.random.choice([-1, 0, 1], size=(3, 4), p=[0.3, 0.4, 0.3]).astype(float)
    biases = np.random.randint(-1, 2, size=3).astype(float)

    # Test ternary mode
    ternary_output = ternary_layer_numpy(input_vector, weights, biases, add_noise=True, mode="ternary")
    print("Ternary Output:", ternary_output)

    # Test bipolar mode
    bipolar_input = np.random.choice([-1, 1], size=4, p=[0.5, 0.5])
    bipolar_output = ternary_layer_numpy(bipolar_input, weights, biases, add_noise=True, mode="bipolar")
    print("Bipolar Output:", bipolar_output)

def run_forward_numpy(input_vec, layers, add_noise=False, mode="ternary"):
    activations = [input_vec.copy()]
    per_neuron_energy = []
    prev = input_vec.copy()
    for layer in layers:
        out = ternary_layer_numpy(prev, layer["weights"], layer.get("biases", None), add_noise, mode=mode)
        energies = transition_energy_per_neuron(prev, out, dynamic=True)
        per_neuron_energy.append(energies)
        activations.append(out.copy())
        prev = out.copy()
    return activations, per_neuron_energy

def run_forward_gpu_like(input_vec, layers, add_noise=False, mode="ternary"):
    if GPU_AVAILABLE:
        x = cp.array(input_vec)
        acts = [cp.asnumpy(x)]
        ener = []
        prev = x
        for layer in layers:
            W = cp.array(layer["weights"])
            b = cp.array(layer.get("biases", np.zeros(W.shape[0])))
            if add_noise:
                W = W + cp.random.normal(0, 0.05, size=W.shape)
                prev = prev + cp.random.normal(0, 0.05, size=prev.shape)
            # Vectorized computation on GPU
            result = cp.dot(prev, W.T) + b
            if mode == "bipolar":
                mapped = cp.sign(result)
                mapped[result == 0] = 0  # Neutral 0 for bipolar
            else:  # ternary
                mapped = cp.asnumpy(to_ternary_array(cp.asnumpy(result)))
            acts.append(mapped)
            ener.append(transition_energy_per_neuron(cp.asnumpy(prev), mapped, dynamic=True))
            prev = cp.array(mapped)
        return acts, ener
    else:
        return run_forward_numpy(input_vec, layers, add_noise, mode)

# Network: 8-6-4
np.random.seed(123)
input_vector = np.random.choice([-1, 0, 1], size=8, p=[0.3, 0.2, 0.5])
bipolar_input = np.random.choice([-1, 1], size=8, p=[0.5, 0.5])  # Bipolar input
layer1 = {
    "weights": np.random.choice([-1, 0, 1], size=(8, 8), p=[0.3, 0.4, 0.3]).astype(float),
    "biases": np.random.randint(-1, 2, size=8).astype(float)
}
layer2 = {
    "weights": np.random.choice([-1, 0, 1], size=(6, 8), p=[0.3, 0.4, 0.3]).astype(float),
    "biases": np.random.randint(-1, 2, size=6).astype(float)
}
layer3 = {
    "weights": np.random.choice([-1, 0, 1], size=(4, 6), p=[0.3, 0.4, 0.3]).astype(float),
    "biases": np.random.randint(-1, 2, size=4).astype(float)
}
layers = [layer1, layer2, layer3]

# Run simulations
activations_cpu_ternary, energies_cpu_ternary = run_forward_numpy(input_vector, layers, add_noise=True, mode="ternary")
activations_gpu_ternary, energies_gpu_ternary = run_forward_gpu_like(input_vector, layers, add_noise=True, mode="ternary")
activations_cpu_bipolar, energies_cpu_bipolar = run_forward_numpy(bipolar_input, layers, add_noise=True, mode="bipolar")
activations_gpu_bipolar, energies_gpu_bipolar = run_forward_gpu_like(bipolar_input, layers, add_noise=True, mode="bipolar")

# Save outputs
tmpdir = tempfile.mkdtemp()
csv_path = os.path.join(tmpdir, "per_neuron_energy.csv")
with open(csv_path, "w", newline="") as csvfile:
    writer = csv.writer(csvfile)
    header = []
    for li in range(len(activations_cpu_ternary) - 1):
        next_size = len(activations_cpu_ternary[li + 1])
        for nj in range(next_size):
            header.append(f"Trans_L{li}_to_L{li+1}_N{nj}")
    writer.writerow(["Run", "Mode"] + header)
    row = ["run1", "CPU_Ternary"]
    for energies in energies_cpu_ternary:
        row.extend(energies)
    writer.writerow(row)
    row = ["run1", "GPU_Ternary"]
    for energies in energies_gpu_ternary:
        row.extend(energies)
    writer.writerow(row)
    row = ["run1", "CPU_Bipolar"]
    for energies in energies_cpu_bipolar:
        row.extend(energies)
    writer.writerow(row)
    row = ["run1", "GPU_Bipolar"]
    for energies in energies_gpu_bipolar:
        row.extend(energies)
    writer.writerow(row)